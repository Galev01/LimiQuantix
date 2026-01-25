//! Process management handlers.
//!
//! Handles process listing and kill operations.
//! Uses sysinfo crate for cross-platform process information.

use limiquantix_proto::agent::{
    agent_message, KillProcessRequest, KillProcessResponse, ListProcessesRequest,
    ListProcessesResponse, ProcessInfo,
};
use prost_types::Timestamp;
use sysinfo::{Pid, ProcessStatus, Signal, System};
use tracing::{debug, error, info, warn};

/// Handle a list processes request.
pub async fn handle_list_processes(req: ListProcessesRequest) -> agent_message::Payload {
    debug!(
        filter = %req.filter,
        include_threads = req.include_threads,
        max_entries = req.max_entries,
        "Handling list processes request"
    );

    let mut sys = System::new_all();
    sys.refresh_all();

    let mut processes: Vec<ProcessInfo> = Vec::new();
    let max_entries = if req.max_entries > 0 {
        req.max_entries as usize
    } else {
        usize::MAX
    };

    for (pid, process) in sys.processes() {
        // Apply filter if specified
        if !req.filter.is_empty() {
            let name = process.name().to_string_lossy().to_lowercase();
            let filter = req.filter.to_lowercase();
            if !name.contains(&filter) {
                continue;
            }
        }

        if processes.len() >= max_entries {
            break;
        }

        let process_info = ProcessInfo {
            pid: pid.as_u32(),
            ppid: process.parent().map(|p| p.as_u32()).unwrap_or(0),
            name: process.name().to_string_lossy().to_string(),
            command_line: process.cmd().iter().map(|s| s.to_string_lossy().to_string()).collect::<Vec<_>>().join(" "),
            user: get_process_user(process),
            cpu_percent: process.cpu_usage() as f64,
            memory_bytes: process.memory(),
            state: process_state_to_string(process.status()),
            started_at: process_start_time(process),
            thread_count: 0, // sysinfo doesn't provide thread count directly
            working_directory: process
                .cwd()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
        };

        processes.push(process_info);
    }

    // Sort by PID
    processes.sort_by_key(|p| p.pid);

    info!(count = processes.len(), "Listed processes");

    agent_message::Payload::ListProcessesResponse(ListProcessesResponse {
        success: true,
        processes,
        error: String::new(),
    })
}

/// Handle a kill process request.
pub async fn handle_kill_process(req: KillProcessRequest) -> agent_message::Payload {
    info!(
        pid = req.pid,
        signal = req.signal,
        "Handling kill process request"
    );

    let pid = Pid::from_u32(req.pid);

    // Determine signal to send
    let signal = match req.signal {
        0 | 15 => Signal::Term, // SIGTERM (default)
        9 => Signal::Kill,      // SIGKILL
        1 => Signal::Hangup,    // SIGHUP
        2 => Signal::Interrupt, // SIGINT
        3 => Signal::Quit,      // SIGQUIT
        _ => {
            warn!(signal = req.signal, "Unknown signal, using SIGTERM");
            Signal::Term
        }
    };

    let mut sys = System::new_all();
    sys.refresh_all();

    // Find the process
    if let Some(process) = sys.process(pid) {
        // Try to kill the process
        if process.kill_with(signal).unwrap_or(false) {
            info!(pid = req.pid, signal = ?signal, "Process killed successfully");
            agent_message::Payload::KillProcessResponse(KillProcessResponse {
                success: true,
                error: String::new(),
            })
        } else {
            // Try with SIGKILL as fallback
            if signal != Signal::Kill && process.kill_with(Signal::Kill).unwrap_or(false) {
                info!(pid = req.pid, "Process killed with SIGKILL fallback");
                agent_message::Payload::KillProcessResponse(KillProcessResponse {
                    success: true,
                    error: String::new(),
                })
            } else {
                error!(pid = req.pid, "Failed to kill process");
                agent_message::Payload::KillProcessResponse(KillProcessResponse {
                    success: false,
                    error: "Failed to kill process".to_string(),
                })
            }
        }
    } else {
        error!(pid = req.pid, "Process not found");
        agent_message::Payload::KillProcessResponse(KillProcessResponse {
            success: false,
            error: format!("Process {} not found", req.pid),
        })
    }
}

/// Get the username running a process.
fn get_process_user(process: &sysinfo::Process) -> String {
    process
        .user_id()
        .map(|uid| {
            #[cfg(unix)]
            {
                // Try to resolve username from UID
                use nix::unistd::{Uid, User};
                let uid_raw = uid.to_string().parse::<u32>().unwrap_or(0);
                User::from_uid(Uid::from_raw(uid_raw))
                    .ok()
                    .flatten()
                    .map(|u| u.name)
                    .unwrap_or_else(|| uid.to_string())
            }
            #[cfg(windows)]
            {
                uid.to_string()
            }
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// Convert process status to string.
fn process_state_to_string(status: ProcessStatus) -> String {
    match status {
        ProcessStatus::Run => "running".to_string(),
        ProcessStatus::Sleep => "sleeping".to_string(),
        ProcessStatus::Stop => "stopped".to_string(),
        ProcessStatus::Zombie => "zombie".to_string(),
        ProcessStatus::Idle => "idle".to_string(),
        ProcessStatus::Dead => "dead".to_string(),
        _ => "unknown".to_string(),
    }
}

/// Get process start time as Timestamp.
fn process_start_time(process: &sysinfo::Process) -> Option<Timestamp> {
    let start_time = process.start_time();
    if start_time > 0 {
        Some(Timestamp {
            seconds: start_time as i64,
            nanos: 0,
        })
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_list_processes() {
        let req = ListProcessesRequest {
            filter: String::new(),
            include_threads: false,
            max_entries: 10,
        };

        let response = handle_list_processes(req).await;

        if let agent_message::Payload::ListProcessesResponse(resp) = response {
            assert!(resp.success);
            assert!(!resp.processes.is_empty());
        } else {
            panic!("Unexpected response type");
        }
    }

    #[test]
    fn test_process_state_to_string() {
        assert_eq!(process_state_to_string(ProcessStatus::Run), "running");
        assert_eq!(process_state_to_string(ProcessStatus::Sleep), "sleeping");
        assert_eq!(process_state_to_string(ProcessStatus::Zombie), "zombie");
    }
}
