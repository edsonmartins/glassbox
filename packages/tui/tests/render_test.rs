use ratatui::backend::TestBackend;
use ratatui::Terminal;

use glassbox_tui::app::{App, ControlMode, SessionPhase};
use glassbox_tui::ui;

/// Render the app at a given size and return the buffer content as a string.
fn render_to_string(width: u16, height: u16, setup: impl FnOnce(&mut App)) -> String {
    let backend = TestBackend::new(width, height);
    let mut terminal = Terminal::new(backend).unwrap();
    let mut app = App::new();
    setup(&mut app);

    terminal.draw(|frame| ui::render(frame, &app)).unwrap();

    let buf = terminal.backend().buffer().clone();
    let mut output = String::new();
    for y in 0..height {
        for x in 0..width {
            output.push(buf[(x, y)].symbol().chars().next().unwrap_or(' '));
        }
        output.push('\n');
    }
    output
}

#[test]
fn render_waiting_state() {
    let output = render_to_string(120, 30, |app| {
        app.phase = SessionPhase::Waiting;
        app.main_class = "com.example.App".to_string();
    });

    assert!(output.contains("Glassbox"), "Title bar should show Glassbox");
    assert!(output.contains("Waiting"), "Status bar should show Waiting");
}

#[test]
fn render_complete_state_shows_summary() {
    let output = render_to_string(120, 30, |app| {
        app.phase = SessionPhase::Complete;
        app.main_class = "com.example.App".to_string();
        app.tokens_used = 112;
        app.tool_calls = 6;
        app.bugs_found = 1;
        app.show_summary = true;
        app.duration_ms = 3200.0;
    });

    assert!(output.contains("Session Summary"), "Should show summary overlay");
    assert!(output.contains("Complete"), "Should show Complete status");
}

#[test]
fn render_manual_mode_shows_hotkeys() {
    let output = render_to_string(120, 30, |app| {
        app.control_mode = ControlMode::Manual;
        app.phase = SessionPhase::Investigating;
    });

    assert!(output.contains("MANUAL"), "Status bar should show MANUAL");
    assert!(output.contains("[F5]"), "Should show debug hotkeys in manual mode");
}

#[test]
fn render_minimal_layout() {
    let output = render_to_string(60, 20, |app| {
        app.phase = SessionPhase::Waiting;
        app.main_class = "com.example.App".to_string();
    });

    assert!(output.contains("Glassbox"), "Even minimal layout shows title");
}

#[test]
fn render_fix_proposed_shows_diff_title() {
    let output = render_to_string(120, 30, |app| {
        app.phase = SessionPhase::Fix;
        app.main_class = "com.example.App".to_string();
        app.proposed_fix = Some(glassbox_tui::protocol::types::FixProposedData {
            bug_id: "NPE-001".into(),
            fix_type: "code_change".into(),
            file: "PedidoService.java".into(),
            diff: "- .orElse(null);\n+ .orElseThrow(() -> new EntityNotFoundException());".into(),
            explanation: "Replace orElse(null)".into(),
            confidence: 0.95,
        });
    });

    assert!(output.contains("DIFF"), "Source panel should show [DIFF] title when fix is proposed");
}
