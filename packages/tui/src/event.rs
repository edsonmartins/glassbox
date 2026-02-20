use std::io::BufRead;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crossterm::event::{self, Event, KeyEvent};

use glassbox_tui::protocol::parser::parse_event;
use glassbox_tui::protocol::types::GlassboxEvent;
use crate::socket::SocketConnection;

/// Events that the main loop processes.
pub enum AppEvent {
    /// A terminal key press.
    Key(KeyEvent),
    /// Terminal resize.
    Resize(u16, u16),
    /// A parsed GlassBox event from the JSONL stream.
    Glassbox(GlassboxEvent),
    /// Periodic tick for animations.
    Tick,
    /// The JSONL input stream has ended.
    InputClosed,
    /// A malformed JSONL line (logged to event log).
    ParseError(String),
}

/// How the TUI receives events.
pub enum InputMode {
    /// Read JSONL from stdin (pipe mode).
    Stdin,
    /// Connect to a Unix domain socket.
    Socket(String),
}

/// Start background threads that feed AppEvents into the returned receiver.
///
/// - Thread 1: crossterm terminal event polling (keys, resize, tick)
/// - Thread 2: JSONL reader from stdin OR socket connection
///
/// Returns the event receiver and an optional SocketConnection for sending commands.
pub fn start_event_threads(mode: InputMode) -> (mpsc::Receiver<AppEvent>, Option<SocketConnection>) {
    let (tx, rx) = mpsc::channel();

    // Thread 1: Terminal events (same for both modes)
    let tx_term = tx.clone();
    thread::spawn(move || {
        loop {
            // Poll with 100ms timeout to allow tick events
            if event::poll(Duration::from_millis(100)).unwrap_or(false) {
                if let Ok(ev) = event::read() {
                    match ev {
                        Event::Key(key) => {
                            if tx_term.send(AppEvent::Key(key)).is_err() {
                                return;
                            }
                        }
                        Event::Resize(w, h) => {
                            if tx_term.send(AppEvent::Resize(w, h)).is_err() {
                                return;
                            }
                        }
                        _ => {}
                    }
                }
            } else {
                // No terminal event — send a tick
                if tx_term.send(AppEvent::Tick).is_err() {
                    return;
                }
            }
        }
    });

    // Thread 2: JSONL input (stdin or socket)
    let socket_conn = match mode {
        InputMode::Stdin => {
            let tx_jsonl = tx;
            thread::spawn(move || {
                let stdin = std::io::stdin();
                let reader = stdin.lock();
                for line in reader.lines() {
                    match line {
                        Ok(l) if l.trim().is_empty() => continue,
                        Ok(l) => match parse_event(&l) {
                            Ok(ev) => {
                                if tx_jsonl.send(AppEvent::Glassbox(ev)).is_err() {
                                    return;
                                }
                            }
                            Err(e) => {
                                let msg = format!(
                                    "Parse error: {} (line: {})",
                                    e,
                                    if l.len() > 60 { &l[..60] } else { &l }
                                );
                                let _ = tx_jsonl.send(AppEvent::ParseError(msg));
                            }
                        },
                        Err(_) => break,
                    }
                }
                let _ = tx_jsonl.send(AppEvent::InputClosed);
            });
            None
        }
        InputMode::Socket(path) => {
            match SocketConnection::connect(&path, tx) {
                Ok(conn) => Some(conn),
                Err(e) => {
                    eprintln!("Failed to connect to socket {}: {}", path, e);
                    None
                }
            }
        }
    };

    (rx, socket_conn)
}
