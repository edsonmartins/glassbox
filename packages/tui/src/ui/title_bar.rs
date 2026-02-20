use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, ConnectionStatus, SessionPhase};
use crate::theme;

pub fn render(frame: &mut Frame, area: Rect, app: &App) {
    let status_text = match app.phase {
        SessionPhase::Complete => "COMPLETE",
        SessionPhase::Starting => "STARTING",
        _ => "LIVE",
    };
    let status_color = match app.phase {
        SessionPhase::Complete | SessionPhase::Starting => theme::YELLOW,
        _ => theme::GREEN,
    };

    let main_class = if app.main_class.is_empty() {
        "Awaiting connection..."
    } else {
        &app.main_class
    };

    let (conn_text, conn_color) = match app.connection_status {
        ConnectionStatus::PipeMode => ("PIPE", theme::TEXT_DIM),
        ConnectionStatus::Connecting => ("CONNECTING", theme::YELLOW),
        ConnectionStatus::Connected => ("CONNECTED", theme::GREEN),
        ConnectionStatus::Disconnected => ("DISCONNECTED", theme::RED),
    };

    let title = Paragraph::new(Line::from(vec![
        Span::styled(" Glassbox ", Style::default().fg(theme::ACCENT).bold()),
        Span::styled("| ", Style::default().fg(theme::BORDER)),
        Span::styled(format!("{} ", main_class), Style::default().fg(theme::TEXT)),
        Span::styled("| ", Style::default().fg(theme::BORDER)),
        Span::styled(format!("{} ", status_text), Style::default().fg(status_color).bold()),
        Span::styled("| ", Style::default().fg(theme::BORDER)),
        Span::styled(format!("{} ", conn_text), Style::default().fg(conn_color)),
        Span::styled("| ", Style::default().fg(theme::BORDER)),
        Span::styled(format!("{} tokens", app.tokens_used), Style::default().fg(theme::CYAN)),
        Span::styled(
            format!(" ~${:.3}", if app.estimated_cost_usd > 0.0 { app.estimated_cost_usd } else { app.tokens_used as f64 * 0.00003 }),
            Style::default().fg(theme::TEXT_DIM),
        ),
    ]))
    .block(
        Block::default()
            .borders(Borders::BOTTOM)
            .border_style(Style::default().fg(theme::BORDER))
            .style(Style::default().bg(theme::BG_PANEL)),
    );
    frame.render_widget(title, area);
}
