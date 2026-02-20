use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};

use crate::theme;

pub fn render(frame: &mut Frame) {
    let area = frame.area();
    let popup_width = 60.min(area.width.saturating_sub(4));
    let popup_height = 22.min(area.height.saturating_sub(4));

    let x = (area.width.saturating_sub(popup_width)) / 2;
    let y = (area.height.saturating_sub(popup_height)) / 2;
    let popup_area = Rect::new(x, y, popup_width, popup_height);

    frame.render_widget(Clear, popup_area);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::ACCENT))
        .title(Span::styled(" Help ", Style::default().fg(theme::ACCENT).bold()))
        .style(Style::default().bg(theme::BG_PANEL));

    let help_text = vec![
        Line::from(""),
        Line::from(Span::styled(" Navigation", Style::default().fg(theme::ACCENT).bold())),
        Line::from(Span::styled("  Tab        Cycle active panel", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  1-5        Jump to panel", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  j/k        Scroll down/up", Style::default().fg(theme::TEXT))),
        Line::from(""),
        Line::from(Span::styled(" Debug Control (Manual/Collab)", Style::default().fg(theme::ACCENT).bold())),
        Line::from(Span::styled("  F5         Continue", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  F9         Toggle breakpoint", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  F10        Step over", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  F11        Step into", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  F12        Step out", Style::default().fg(theme::TEXT))),
        Line::from(""),
        Line::from(Span::styled(" Actions", Style::default().fg(theme::ACCENT).bold())),
        Line::from(Span::styled("  R          Toggle AI/Manual mode", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  A          Apply proposed fix", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  D          Discard proposed fix", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  S          Save session report", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  q          Quit", Style::default().fg(theme::TEXT))),
        Line::from(Span::styled("  ?/F1       Toggle this help", Style::default().fg(theme::TEXT))),
    ];

    frame.render_widget(
        Paragraph::new(help_text)
            .wrap(Wrap { trim: false })
            .block(block),
        popup_area,
    );
}
