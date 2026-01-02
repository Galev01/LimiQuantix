//! Protocol handling for length-prefixed protobuf messages.
//!
//! Since virtio-serial is a byte stream without message boundaries,
//! we use a simple framing format:
//!
//! ```text
//! ┌──────────────────┬───────────────────────────────────────────┐
//! │  4 bytes (BE)    │          N bytes                          │
//! │  Message Length  │          Protobuf Payload                 │
//! └──────────────────┴───────────────────────────────────────────┘
//! ```

use anyhow::{anyhow, Context, Result};
use prost::Message;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::{debug, trace};

/// Maximum message size (16 MB)
const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

/// Read a length-prefixed protobuf message from the stream.
///
/// Returns `Ok(Some(message))` on success, `Ok(None)` if the stream is closed,
/// or `Err` on error.
pub async fn read_message<R, M>(reader: &mut R) -> Result<Option<M>>
where
    R: AsyncReadExt + Unpin,
    M: Message + Default,
{
    // Read the 4-byte length prefix
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            // Stream closed
            return Ok(None);
        }
        Err(e) => {
            return Err(e).context("Failed to read message length");
        }
    }

    let len = u32::from_be_bytes(len_buf) as usize;
    trace!(length = len, "Reading message payload");

    // Validate message size
    if len > MAX_MESSAGE_SIZE {
        return Err(anyhow!(
            "Message too large: {} bytes (max {})",
            len,
            MAX_MESSAGE_SIZE
        ));
    }

    // Read the payload
    let mut payload_buf = vec![0u8; len];
    reader
        .read_exact(&mut payload_buf)
        .await
        .context("Failed to read message payload")?;

    // Decode the protobuf message
    let message = M::decode(&payload_buf[..]).context("Failed to decode protobuf message")?;

    debug!(length = len, "Message received and decoded");
    Ok(Some(message))
}

/// Write a length-prefixed protobuf message to the stream.
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

    debug!(length = len, "Message written");
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
}
