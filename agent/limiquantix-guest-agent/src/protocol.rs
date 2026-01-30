//! Protocol handling for length-prefixed protobuf messages with magic header.
//!
//! Since virtio-serial is a byte stream without message boundaries,
//! we use a framing format with a magic header for resync capability:
//!
//! ```text
//! ┌──────────────────┬──────────────────┬───────────────────────────────────┐
//! │  4 bytes         │  4 bytes (BE)    │          N bytes                  │
//! │  Magic: "QTX1"   │  Message Length  │          Protobuf Payload         │
//! └──────────────────┴──────────────────┴───────────────────────────────────┘
//! ```
//!
//! ## Why Magic Header?
//!
//! If the host connects AFTER the guest has already sent data, the host would
//! read random/stale bytes as the "message length". If those bytes decode as
//! a large number (e.g., 50,000), the host blocks forever waiting for data,
//! creating a deadlock:
//!
//! 1. Host blocks reading 50,000 bytes that will never arrive
//! 2. Host never empties the buffer
//! 3. Guest's writes fill the ring buffer and timeout
//!
//! The magic header ("QTX1") allows the reader to:
//! - Scan for the magic sequence before reading length
//! - Skip garbage bytes until a valid header is found
//! - Resync the protocol after corruption

use anyhow::{anyhow, Context, Result};
use prost::Message;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{debug, trace, warn};

/// Magic header for protocol framing: "QTX1" (Quantix Protocol v1)
/// This allows the reader to resync if it receives garbage/stale data.
pub const MAGIC_HEADER: [u8; 4] = [0x51, 0x54, 0x58, 0x01]; // Q=0x51, T=0x54, X=0x58, 1=0x01

/// Maximum message size (16 MB)
const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// Maximum bytes to scan when resyncing before giving up
const MAX_RESYNC_BYTES: usize = 64 * 1024; // 64KB

/// Read a magic-header-prefixed protobuf message from the stream.
///
/// The protocol format is:
/// - 4 bytes: Magic header "QTX1" (0x51 0x54 0x58 0x01)
/// - 4 bytes: Message length (big-endian u32)
/// - N bytes: Protobuf payload
///
/// If garbage data is encountered, this function will scan for the magic header,
/// discarding invalid bytes until a valid message is found.
///
/// Returns `Ok(Some(message))` on success, `Ok(None)` if the stream is closed,
/// or `Err` on unrecoverable error.
pub async fn read_message<R, M>(reader: &mut R) -> Result<Option<M>>
where
    R: AsyncReadExt + Unpin,
    M: Message + Default,
{
    // Track total bytes scanned across ALL resync attempts in this function call
    let mut total_resync_bytes: usize = 0;
    
    loop {
        // Reset per-iteration resync counter (CRITICAL FIX: was not being reset before)
        let mut resync_bytes_this_iteration: usize = 0;
        
        // 1. Scan for Magic Header (Resync Mechanism)
        let mut header_byte = [0u8; 1];
        let mut match_count: usize = 0;

        while match_count < 4 {
            match reader.read(&mut header_byte).await {
                Ok(0) => {
                    // EOF
                    if total_resync_bytes > 0 {
                        debug!(total_bytes_scanned = total_resync_bytes, "EOF reached during resync");
                    }
                    return Ok(None);
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                    return Ok(None);
                }
                Err(e) => {
                    return Err(e).context("Failed to read magic header");
                }
            }

            // Count EVERY byte we read (CRITICAL FIX: was only counting mismatches)
            resync_bytes_this_iteration += 1;

            if header_byte[0] == MAGIC_HEADER[match_count] {
                match_count += 1;
            } else {
                // Mismatch - log progress periodically
                if resync_bytes_this_iteration > 0 && resync_bytes_this_iteration % 1000 == 0 {
                    warn!(
                        bytes_scanned_this_attempt = resync_bytes_this_iteration,
                        total_bytes_scanned = total_resync_bytes + resync_bytes_this_iteration,
                        "Protocol resync in progress - scanning for magic header"
                    );
                }
                
                // Check if current byte could be start of new magic sequence
                match_count = if header_byte[0] == MAGIC_HEADER[0] { 1 } else { 0 };
                
                // Safety limit to prevent infinite scanning
                if total_resync_bytes + resync_bytes_this_iteration > MAX_RESYNC_BYTES {
                    return Err(anyhow!(
                        "Failed to find magic header after scanning {} bytes - connection may be corrupted",
                        total_resync_bytes + resync_bytes_this_iteration
                    ));
                }
            }
        }

        // We found the magic header!
        // Subtract 4 from resync count since the magic header bytes are valid
        let garbage_bytes = resync_bytes_this_iteration.saturating_sub(4);
        
        // Log if we had to skip garbage
        if garbage_bytes > 0 {
            warn!(
                garbage_bytes_skipped = garbage_bytes,
                "Protocol resynced - skipped garbage bytes before finding valid header"
            );
        }
        
        // Reset total counter since we found a valid header
        total_resync_bytes = 0;

        // 2. Read the 4-byte length prefix
        let mut len_buf = [0u8; 4];
        match reader.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(None);
            }
            Err(e) => {
                return Err(e).context("Failed to read message length");
            }
        }

        let len = u32::from_be_bytes(len_buf) as usize;
        trace!(length = len, "Reading message payload");

        // 3. Validate message size - if invalid, resync
        if len == 0 {
            warn!("Received zero-length message after valid header, resyncing...");
            // Add 8 bytes to resync counter (4 magic + 4 length)
            total_resync_bytes += 8;
            continue;
        }
        
        if len > MAX_MESSAGE_SIZE {
            warn!(
                length = len,
                max = MAX_MESSAGE_SIZE,
                length_hex = format!("0x{:08X}", len),
                "Message length exceeds maximum, likely garbage after valid-looking header, resyncing..."
            );
            // Add 8 bytes to resync counter (4 magic + 4 length)
            total_resync_bytes += 8;
            continue;
        }

        // 4. Read the payload
        let mut payload_buf = vec![0u8; len];
        match reader.read_exact(&mut payload_buf).await {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Ok(None);
            }
            Err(e) => {
                return Err(e).context("Failed to read message payload");
            }
        }

        // 5. Decode the protobuf message
        match M::decode(&payload_buf[..]) {
            Ok(message) => {
                debug!(length = len, "Message received and decoded successfully");
                return Ok(Some(message));
            }
            Err(e) => {
                warn!(
                    error = %e,
                    length = len,
                    "Failed to decode protobuf message, resyncing..."
                );
                // Add consumed bytes to resync counter (8 header + payload)
                total_resync_bytes += 8 + len;
                continue;
            }
        }
    }
}

/// Write a magic-header-prefixed protobuf message to the stream.
///
/// The protocol format is:
/// - 4 bytes: Magic header "QTX1" (0x51 0x54 0x58 0x01)
/// - 4 bytes: Message length (big-endian u32)
/// - N bytes: Protobuf payload
pub async fn write_message<W, M>(writer: &mut W, message: &M) -> Result<()>
where
    W: AsyncWriteExt + Unpin,
    M: Message,
{
    // Encode the message
    let payload = message.encode_to_vec();
    let len = payload.len();

    trace!(length = len, "Writing message");

    // Validate message size
    if len > MAX_MESSAGE_SIZE {
        return Err(anyhow!(
            "Message too large: {} bytes (max {})",
            len,
            MAX_MESSAGE_SIZE
        ));
    }

    // Write magic header first
    writer
        .write_all(&MAGIC_HEADER)
        .await
        .context("Failed to write magic header")?;

    // Write the length prefix
    let len_bytes = (len as u32).to_be_bytes();
    writer
        .write_all(&len_bytes)
        .await
        .context("Failed to write message length")?;

    // Write the payload
    writer
        .write_all(&payload)
        .await
        .context("Failed to write message payload")?;

    // Flush to ensure delivery
    writer.flush().await.context("Failed to flush message")?;

    debug!(length = len, "Message written with magic header");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use limiquantix_proto::agent::{agent_message, AgentMessage, PingRequest};
    use prost_types::Timestamp;
    use std::io::Cursor;
    use tokio::io::BufReader;

    #[tokio::test]
    async fn test_roundtrip() {
        let original = AgentMessage {
            message_id: "test-123".to_string(),
            timestamp: Some(Timestamp {
                seconds: 1234567890,
                nanos: 123456789,
            }),
            payload: Some(agent_message::Payload::Ping(PingRequest { sequence: 42 })),
        };

        // Write to buffer
        let mut buffer = Vec::new();
        write_message(&mut buffer, &original).await.unwrap();

        // Verify magic header is present
        assert_eq!(&buffer[0..4], &MAGIC_HEADER);

        // Read back
        let mut reader = BufReader::new(Cursor::new(buffer));
        let decoded: AgentMessage = read_message(&mut reader).await.unwrap().unwrap();

        assert_eq!(decoded.message_id, original.message_id);
        assert_eq!(decoded.timestamp, original.timestamp);

        match decoded.payload {
            Some(agent_message::Payload::Ping(ping)) => {
                assert_eq!(ping.sequence, 42);
            }
            _ => panic!("Wrong payload type"),
        }
    }

    #[tokio::test]
    async fn test_empty_stream() {
        let buffer: Vec<u8> = Vec::new();
        let mut reader = BufReader::new(Cursor::new(buffer));
        let result: Option<AgentMessage> = read_message(&mut reader).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_resync_after_garbage() {
        let original = AgentMessage {
            message_id: "test-456".to_string(),
            timestamp: Some(Timestamp {
                seconds: 1234567890,
                nanos: 0,
            }),
            payload: Some(agent_message::Payload::Ping(PingRequest { sequence: 99 })),
        };

        // Write valid message
        let mut valid_msg = Vec::new();
        write_message(&mut valid_msg, &original).await.unwrap();

        // Prepend garbage bytes
        let mut buffer = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00, 0x00, 0x10]; // 8 bytes of garbage
        buffer.extend_from_slice(&valid_msg);

        // Should resync and find the valid message
        let mut reader = BufReader::new(Cursor::new(buffer));
        let decoded: AgentMessage = read_message(&mut reader).await.unwrap().unwrap();

        assert_eq!(decoded.message_id, "test-456");
    }

    #[tokio::test]
    async fn test_resync_partial_magic() {
        let original = AgentMessage {
            message_id: "test-789".to_string(),
            timestamp: Some(Timestamp {
                seconds: 1234567890,
                nanos: 0,
            }),
            payload: Some(agent_message::Payload::Ping(PingRequest { sequence: 77 })),
        };

        // Write valid message
        let mut valid_msg = Vec::new();
        write_message(&mut valid_msg, &original).await.unwrap();

        // Prepend partial magic header (Q, T) followed by garbage, then real message
        let mut buffer = vec![0x51, 0x54, 0xFF, 0xFF]; // Partial "QT" then garbage
        buffer.extend_from_slice(&valid_msg);

        // Should resync past the partial match
        let mut reader = BufReader::new(Cursor::new(buffer));
        let decoded: AgentMessage = read_message(&mut reader).await.unwrap().unwrap();

        assert_eq!(decoded.message_id, "test-789");
    }
}
