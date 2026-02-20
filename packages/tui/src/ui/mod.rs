pub mod agent_panel;
pub mod event_log;
pub mod help_overlay;
pub mod side_info;
pub mod source_panel;
pub mod status_bar;
pub mod summary_overlay;
pub mod syntax;
pub mod title_bar;
pub mod variables_panel;

use ratatui::prelude::*;
use ratatui::widgets::{Block, Paragraph};

use crate::app::App;
use crate::layout::{self, LayoutMode};
use crate::theme;

/// Render the full TUI based on terminal width.
pub fn render(frame: &mut Frame, app: &App) {
    let area = frame.area();

    // Background fill
    frame.render_widget(
        Block::default().style(Style::default().bg(theme::BG)),
        area,
    );

    let mode = layout::compute_layout_mode(area.width);
    let chunks = layout::main_layout(area, mode);

    match mode {
        LayoutMode::Full => render_full(frame, &chunks, app),
        LayoutMode::Compact => render_compact(frame, &chunks, app),
        LayoutMode::Minimal => render_minimal(frame, &chunks, app),
    }

    // Command prompt (above status bar)
    if let Some(ref input) = app.command_input {
        let prompt_area = Rect::new(area.x, area.height.saturating_sub(2), area.width, 1);
        let text = format!("glassbox> {}", input);
        frame.render_widget(
            Paragraph::new(Line::from(vec![
                Span::styled("glassbox> ", Style::default().fg(theme::ACCENT).bold()),
                Span::styled(input.as_str(), Style::default().fg(theme::TEXT_BRIGHT)),
                Span::styled("_", Style::default().fg(theme::TEXT_BRIGHT)),
            ]))
            .style(Style::default().bg(theme::BG_PANEL)),
            prompt_area,
        );
        // Suppress unused warning
        let _ = text;
    }

    // Overlays (on top of everything)
    if app.show_help {
        help_overlay::render(frame);
    }
    if app.show_summary {
        summary_overlay::render(frame, app);
    }
}

/// Full layout (>= 120 cols): title, main (source+vars+agent), side_info, event_log, status.
fn render_full(frame: &mut Frame, chunks: &[Rect], app: &App) {
    title_bar::render(frame, chunks[0], app);

    // Main area: Source (55%) | Variables + Agent (45%)
    let (source_area, right_area) = layout::main_horizontal(chunks[1]);
    let (vars_area, agent_area) = layout::right_vertical(right_area);

    source_panel::render(frame, source_area, app);
    variables_panel::render(frame, vars_area, app);
    agent_panel::render(frame, agent_area, app);

    // Side info: Call Stack | Threads
    let (stack_area, threads_area) = layout::side_info_split(chunks[2]);
    side_info::render(frame, stack_area, threads_area, app);

    event_log::render(frame, chunks[3], app);
    status_bar::render(frame, chunks[4], app);
}

/// Compact layout (80-119 cols): title, main (source+agent), event_log, status.
fn render_compact(frame: &mut Frame, chunks: &[Rect], app: &App) {
    title_bar::render(frame, chunks[0], app);

    let (source_area, agent_area) = layout::main_horizontal(chunks[1]);
    source_panel::render(frame, source_area, app);
    agent_panel::render(frame, agent_area, app);

    event_log::render(frame, chunks[2], app);
    status_bar::render(frame, chunks[3], app);
}

/// Minimal layout (< 80 cols): title, event_log, status.
fn render_minimal(frame: &mut Frame, chunks: &[Rect], app: &App) {
    title_bar::render(frame, chunks[0], app);
    event_log::render(frame, chunks[1], app);
    status_bar::render(frame, chunks[2], app);
}
