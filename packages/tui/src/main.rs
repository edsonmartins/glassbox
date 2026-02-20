mod event;
mod socket;

use std::io;

use clap::Parser;
use crossterm::{
    event::KeyEventKind,
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;

use glassbox_tui::app::{App, ConnectionStatus};
use glassbox_tui::input::{self, Action};
use glassbox_tui::ui;
use event::{AppEvent, InputMode};

#[derive(Parser, Debug)]
#[command(name = "glassbox-tui", version, about = "GlassBox TUI — observe the AI debugger in real time")]
struct Cli {
    /// Input source: stdin (pipe JSONL) or socket
    #[arg(long, default_value = "stdin")]
    input: String,

    /// Unix socket path (when --input socket)
    #[arg(long)]
    socket: Option<String>,
}

fn main() -> io::Result<()> {
    let cli = Cli::parse();

    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Run app
    let result = run_app(&mut terminal, cli);

    // Restore terminal
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    result
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, cli: Cli) -> io::Result<()> {
    let mut app = App::new();

    // Get initial terminal size
    let size = terminal.size()?;
    app.terminal_size = (size.width, size.height);

    // Determine input mode
    let input_mode = if cli.input == "socket" {
        let path = cli.socket.unwrap_or_else(|| {
            discover_socket().unwrap_or_else(|| "/tmp/glassbox.sock".to_string())
        });
        app.connection_status = ConnectionStatus::Connecting;
        InputMode::Socket(path)
    } else {
        app.connection_status = ConnectionStatus::PipeMode;
        InputMode::Stdin
    };

    // Start background event threads
    let (rx, socket_conn) = event::start_event_threads(input_mode);

    // Update connection status
    if socket_conn.is_some() {
        app.connection_status = ConnectionStatus::Connected;
    } else if app.connection_status == ConnectionStatus::Connecting {
        app.connection_status = ConnectionStatus::Disconnected;
    }

    loop {
        terminal.draw(|frame| ui::render(frame, &app))?;

        match rx.recv() {
            Ok(AppEvent::Key(key)) => {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                match input::handle_key(&mut app, key) {
                    Action::Quit => return Ok(()),
                    Action::SendCommand(cmd) => {
                        if let Some(ref conn) = socket_conn {
                            if let Err(e) = conn.send_command(&cmd) {
                                app.add_parse_error(format!("Socket send error: {}", e));
                            }
                        }
                    }
                    Action::None => {}
                }
            }
            Ok(AppEvent::Resize(w, h)) => {
                app.terminal_size = (w, h);
            }
            Ok(AppEvent::Glassbox(ev)) => {
                app.apply_event(ev);
            }
            Ok(AppEvent::Tick) => {
                app.tick();
            }
            Ok(AppEvent::ParseError(msg)) => {
                app.parse_errors += 1;
                app.add_parse_error(msg);
            }
            Ok(AppEvent::InputClosed) => {
                if app.connection_status == ConnectionStatus::Connected {
                    app.connection_status = ConnectionStatus::Disconnected;
                }
                // Input stream ended; keep UI up until user quits
            }
            Err(_) => return Ok(()),
        }
    }
}

/// Auto-discover a GlassBox socket in /tmp.
fn discover_socket() -> Option<String> {
    let dir = std::fs::read_dir("/tmp").ok()?;
    for entry in dir {
        let path = entry.ok()?.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.starts_with("glassbox-") && name.ends_with(".sock") {
                return Some(path.to_string_lossy().to_string());
            }
        }
    }
    None
}
