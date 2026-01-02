//! Command execution handler.
//!
//! Handles ExecuteRequest messages to run commands inside the guest VM.

use crate::AgentConfig;
use limiquantix_proto::agent::{agent_message, ExecuteRequest, ExecuteResponse};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tracing::{debug, error, info, warn};

/// Maximum output size to capture (default 1MB)
const DEFAULT_MAX_OUTPUT: usize = 1024 * 1024;

/// Handle an execute request.
pub async fn handle_execute(
    req: ExecuteRequest,
    config: &AgentConfig,
) -> agent_message::Payload {
    let start = Instant::now();

    // Determine timeout
    let timeout_secs = if req.timeout_seconds > 0 {
        req.timeout_seconds.min(config.max_exec_timeout_secs)
    } else {
        config.max_exec_timeout_secs
    };

    // Determine max output size
    let max_output = if req.max_output_bytes > 0 {
        req.max_output_bytes as usize
    } else {
        DEFAULT_MAX_OUTPUT
    };

    info!(
        command = %req.command,
        timeout_secs = timeout_secs,
        wait_for_exit = req.wait_for_exit,
        "Executing command"
    );

    // Build the command
    let mut cmd = if req.args.is_empty() {
        // Use shell to execute command string
        #[cfg(unix)]
        {
            let mut c = Command::new("sh");
            c.arg("-c").arg(&req.command);
            c
        }
        #[cfg(windows)]
        {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&req.command);
            c
        }
    } else {
        // Direct execution with args
        let mut c = Command::new(&req.command);
        c.args(&req.args);
        c
    };

    // Set working directory if specified
    if !req.working_directory.is_empty() {
        cmd.current_dir(&req.working_directory);
    }

    // Set environment variables
    for (key, value) in &req.environment {
        cmd.env(key, value);
    }

    // Set up for running as different user (Unix only)
    #[cfg(unix)]
    if !req.run_as_user.is_empty() {
        if let Some(uid) = get_user_uid(&req.run_as_user) {
            unsafe {
                cmd.pre_exec(move || {
                    libc::setuid(uid);
                    Ok(())
                });
            }
        } else {
            return agent_message::Payload::ExecuteResponse(ExecuteResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                timed_out: false,
                duration_ms: 0,
                error: format!("User not found: {}", req.run_as_user),
            });
        }
    }

    // Configure stdio
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());

    // Spawn the process
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            error!(error = %e, command = %req.command, "Failed to spawn command");
            return agent_message::Payload::ExecuteResponse(ExecuteResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                timed_out: false,
                duration_ms: start.elapsed().as_millis() as u64,
                error: format!("Failed to spawn: {}", e),
            });
        }
    };

    // If not waiting for exit, return immediately
    if !req.wait_for_exit {
        debug!(command = %req.command, "Command spawned, not waiting for exit");
        return agent_message::Payload::ExecuteResponse(ExecuteResponse {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            truncated: false,
            timed_out: false,
            duration_ms: start.elapsed().as_millis() as u64,
            error: String::new(),
        });
    }

    // Wait for the process with timeout
    let timeout = Duration::from_secs(timeout_secs as u64);
    let result = tokio::time::timeout(timeout, wait_for_output(child, max_output)).await;

    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok((exit_code, stdout, stderr, truncated))) => {
            info!(
                command = %req.command,
                exit_code = exit_code,
                duration_ms = duration_ms,
                "Command completed"
            );
            agent_message::Payload::ExecuteResponse(ExecuteResponse {
                exit_code,
                stdout,
                stderr,
                truncated,
                timed_out: false,
                duration_ms,
                error: String::new(),
            })
        }
        Ok(Err(e)) => {
            error!(error = %e, command = %req.command, "Command execution error");
            agent_message::Payload::ExecuteResponse(ExecuteResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: String::new(),
                truncated: false,
                timed_out: false,
                duration_ms,
                error: format!("Execution error: {}", e),
            })
        }
        Err(_) => {
            warn!(command = %req.command, timeout_secs = timeout_secs, "Command timed out");
            agent_message::Payload::ExecuteResponse(ExecuteResponse {
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("Command timed out after {} seconds", timeout_secs),
                truncated: false,
                timed_out: true,
                duration_ms,
                error: String::new(),
            })
        }
    }
}

/// Wait for a child process and capture its output.
async fn wait_for_output(
    mut child: tokio::process::Child,
    max_output: usize,
) -> Result<(i32, String, String, bool), std::io::Error> {
    let mut stdout_buf = Vec::with_capacity(max_output.min(65536));
    let mut stderr_buf = Vec::with_capacity(max_output.min(65536));
    let mut truncated = false;

    // Get handles to stdout and stderr
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();

    // Read stdout
    if let Some(ref mut out) = stdout {
        let mut buf = vec![0u8; 4096];
        loop {
            match out.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let remaining = max_output.saturating_sub(stdout_buf.len());
                    if remaining > 0 {
                        let to_take = n.min(remaining);
                        stdout_buf.extend_from_slice(&buf[..to_take]);
                        if to_take < n {
                            truncated = true;
                        }
                    } else {
                        truncated = true;
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::WouldBlock {
                        return Err(e);
                    }
                }
            }
        }
    }

    // Read stderr
    if let Some(ref mut err) = stderr {
        let mut buf = vec![0u8; 4096];
        loop {
            match err.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let remaining = max_output.saturating_sub(stderr_buf.len());
                    if remaining > 0 {
                        let to_take = n.min(remaining);
                        stderr_buf.extend_from_slice(&buf[..to_take]);
                        if to_take < n {
                            truncated = true;
                        }
                    } else {
                        truncated = true;
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::WouldBlock {
                        return Err(e);
                    }
                }
            }
        }
    }

    // Wait for the process to exit
    let status = child.wait().await?;
    let exit_code = status.code().unwrap_or(-1);

    Ok((
        exit_code,
        String::from_utf8_lossy(&stdout_buf).to_string(),
        String::from_utf8_lossy(&stderr_buf).to_string(),
        truncated,
    ))
}

/// Get the UID for a username (Unix only).
#[cfg(unix)]
fn get_user_uid(username: &str) -> Option<u32> {
    use std::ffi::CString;

    let c_username = CString::new(username).ok()?;
    
    unsafe {
        let pwd = libc::getpwnam(c_username.as_ptr());
        if pwd.is_null() {
            None
        } else {
            Some((*pwd).pw_uid)
        }
    }
}

#[cfg(windows)]
fn get_user_uid(_username: &str) -> Option<u32> {
    // Windows doesn't use UIDs in the same way
    None
}
