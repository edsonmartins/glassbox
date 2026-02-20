use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, PanelId};
use crate::protocol::types::EventSource;
use crate::theme;

pub fn render(frame: &mut Frame, area: Rect, app: &App) {
    let is_active = app.active_panel == PanelId::EventLog;
    let border_color = if is_active { theme::BORDER_ACTIVE } else { theme::BORDER };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(
            format!(" Event Log ({}) ", app.event_log.len()),
            Style::default().fg(theme::ACCENT),
        ))
        .style(Style::default().bg(theme::BG_PANEL));

    let inner = block.inner(area);
    frame.render_widget(block, area);

    let visible_height = inner.height as usize;
    let total = app.event_log.len();

    // Scroll handling: auto-scroll shows latest, manual scroll respects offset
    let scroll_offset = app.scroll_offsets.get(&PanelId::EventLog).copied().unwrap_or(0);
    let start = if app.auto_scroll {
        total.saturating_sub(visible_height)
    } else {
        scroll_offset.min(total.saturating_sub(visible_height))
    };
    let end = (start + visible_height).min(total);

    // Calculate available width for text (after timestamp + source icon)
    let text_width = inner.width.saturating_sub(18) as usize; // " HH:MM:SS [XX] " = ~18 chars

    let lines: Vec<Line> = app.event_log[start..end].iter().map(|entry| {
        let (src_icon, src_color) = match entry.src {
            EventSource::Ai => ("AI", theme::ACCENT),
            EventSource::Debugger => ("DB", theme::RED),
            EventSource::User => ("US", theme::ORANGE),
            EventSource::System => ("SY", theme::GREEN),
        };

        let display_text = theme::truncate(&entry.text, text_width);

        Line::from(vec![
            Span::styled(format!(" {} ", entry.ts), Style::default().fg(theme::TEXT_DIM)),
            Span::styled(format!("[{}] ", src_icon), Style::default().fg(src_color)),
            Span::styled(display_text, Style::default().fg(theme::TEXT)),
        ])
    }).collect();

    frame.render_widget(Paragraph::new(lines), inner);
}
