use ratatui::prelude::*;
use ratatui::widgets::Paragraph;

use crate::app::{App, ControlMode, SessionPhase};
use crate::theme;

pub fn render(frame: &mut Frame, area: Rect, app: &App) {
    let mode_color = match app.control_mode {
        ControlMode::Autonomous => theme::ACCENT,
        ControlMode::Manual => theme::ORANGE,
        ControlMode::Collaborative => theme::GREEN,
    };

    let mode_icon = match app.control_mode {
        ControlMode::Autonomous => "AI",
        ControlMode::Manual => "MANUAL",
        ControlMode::Collaborative => "COLLAB",
    };

    let mut spans = vec![
        Span::styled(format!(" {} ", mode_icon), Style::default().fg(mode_color).bold()),
        Span::styled("| ", Style::default().fg(theme::BORDER)),
        Span::styled(format!("{} ", app.phase), Style::default().fg(theme::TEXT)),
        Span::styled("| ", Style::default().fg(theme::BORDER)),
        Span::styled(format!("{}tok ", app.tokens_used), Style::default().fg(theme::CYAN)),
        Span::styled("| ", Style::default().fg(theme::BORDER)),
    ];

    // Compact timeline when terminal is wide enough and we have events
    if area.width >= 120 && !app.event_timestamps.is_empty() {
        let timeline = render_timeline(&app.event_timestamps, app.tool_calls);
        spans.extend(timeline);
        spans.push(Span::styled("| ", Style::default().fg(theme::BORDER)));
    }

    // Context-sensitive hotkeys
    if app.can_user_act() {
        spans.push(Span::styled("[F5]Cont [F10]Over [F11]Into ", Style::default().fg(theme::TEXT_DIM)));
    }
    if app.proposed_fix.is_some() {
        spans.push(Span::styled("[A]Apply [D]Discard ", Style::default().fg(theme::TEXT_DIM)));
    }
    if app.phase == SessionPhase::Complete {
        spans.push(Span::styled("[S]Save ", Style::default().fg(theme::TEXT_DIM)));
    }
    spans.push(Span::styled("[/]Cmd [R]Mode [Tab]Panel [q]Quit [?]Help", Style::default().fg(theme::TEXT_DIM)));

    frame.render_widget(
        Paragraph::new(Line::from(spans))
            .style(Style::default().bg(theme::BG_PANEL).fg(theme::TEXT)),
        area,
    );
}

/// Render a compact timeline like: "14:33:15 ──●──●──●── 14:33:18 (6 calls)"
fn render_timeline(timestamps: &[(String, String)], tool_calls: u64) -> Vec<Span<'static>> {
    let mut spans = Vec::new();

    if let Some(first) = timestamps.first() {
        spans.push(Span::styled(
            format!("{} ", first.0),
            Style::default().fg(theme::TEXT_DIM),
        ));
    }

    spans.push(Span::styled("──", Style::default().fg(theme::BORDER)));
    for (_, label) in timestamps.iter() {
        spans.push(Span::styled("●", Style::default().fg(theme::ORANGE)));
        spans.push(Span::styled(
            label.clone(),
            Style::default().fg(theme::TEXT_DIM),
        ));
        spans.push(Span::styled("──", Style::default().fg(theme::BORDER)));
    }

    if let Some(last) = timestamps.last() {
        spans.push(Span::styled(
            format!(" {} ", last.0),
            Style::default().fg(theme::TEXT_DIM),
        ));
    }

    spans.push(Span::styled(
        format!("({} calls) ", tool_calls),
        Style::default().fg(theme::TEXT_DIM),
    ));

    spans
}
