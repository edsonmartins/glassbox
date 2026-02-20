use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;

use crate::event::AppEvent;
use glassbox_tui::protocol::commands::TuiCommand;
use glassbox_tui::protocol::parser::parse_event;

/// A bidirectional connection to the GlassBox MCP server via Unix domain socket.
///
/// The reader side runs in a background thread, feeding parsed events into
/// the main event loop via mpsc. The writer side is thread-safe (Mutex) so
/// commands can be sent from the main thread.
pub struct SocketConnection {
    writer: Mutex<UnixStream>,
}

impl SocketConnection {
    /// Connect to a Unix domain socket and spawn a reader thread.
    ///
    /// The reader thread reads JSONL lines from the socket, parses them into
    /// GlassboxEvents, and sends them to `tx` as `AppEvent::Glassbox`.
    /// When the connection closes, it sends `AppEvent::InputClosed`.
    pub fn connect(path: &str, tx: mpsc::Sender<AppEvent>) -> io::Result<Self> {
        let stream = UnixStream::connect(path)?;
        let reader_stream = stream.try_clone()?;

        // Spawn reader thread
        thread::spawn(move || {
            let reader = BufReader::new(reader_stream);
            for line in reader.lines() {
                match line {
                    Ok(l) if l.trim().is_empty() => continue,
                    Ok(l) => match parse_event(&l) {
                        Ok(ev) => {
                            if tx.send(AppEvent::Glassbox(ev)).is_err() {
                                return;
                            }
                        }
                        Err(e) => {
                            let msg = format!(
                                "Parse error: {} (line: {})",
                                e,
                                if l.len() > 60 { &l[..60] } else { &l }
                            );
                            let _ = tx.send(AppEvent::ParseError(msg));
                        }
                    },
                    Err(_) => break,
                }
            }
            let _ = tx.send(AppEvent::InputClosed);
        });

        Ok(Self {
            writer: Mutex::new(stream),
        })
    }

    /// Send a TuiCommand to the server as a JSONL line.
    pub fn send_command(&self, cmd: &TuiCommand) -> io::Result<()> {
        let json = serde_json::to_string(cmd)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

        let mut writer = self.writer.lock().map_err(|_| {
            io::Error::new(io::ErrorKind::Other, "socket writer lock poisoned")
        })?;

        writer.write_all(json.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glassbox_tui::protocol::commands::CommandAction;

    #[test]
    fn tui_command_serializes_to_json() {
        let cmd = TuiCommand::simple(CommandAction::Continue);
        let json = serde_json::to_string(&cmd).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["action"], "continue");
    }

    #[test]
    fn tui_command_with_args_serializes() {
        let cmd = TuiCommand::with_args(
            CommandAction::Evaluate,
            serde_json::json!({"expression": "x + 1"}),
        );
        let json = serde_json::to_string(&cmd).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["action"], "evaluate");
        assert_eq!(parsed["args"]["expression"], "x + 1");
    }

    #[test]
    fn all_command_actions_serialize() {
        let actions = vec![
            CommandAction::Continue,
            CommandAction::StepOver,
            CommandAction::StepInto,
            CommandAction::StepOut,
            CommandAction::ToggleBreakpoint,
            CommandAction::Evaluate,
            CommandAction::ToggleControl,
            CommandAction::ApplyFix,
            CommandAction::DiscardFix,
            CommandAction::SaveReport,
        ];
        for action in actions {
            let cmd = TuiCommand::simple(action);
            let json = serde_json::to_string(&cmd).unwrap();
            assert!(json.contains("action"), "should serialize action");
        }
    }
}
