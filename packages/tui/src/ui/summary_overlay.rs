use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Clear, Paragraph, Wrap};

use crate::app::App;
use crate::theme;

pub fn render(frame: &mut Frame, app: &App) {
    let area = frame.area();
    let popup_width = 50.min(area.width.saturating_sub(4));
    let popup_height = 16.min(area.height.saturating_sub(4));

    let x = (area.width.saturating_sub(popup_width)) / 2;
    let y = (area.height.saturating_sub(popup_height)) / 2;
    let popup_area = Rect::new(x, y, popup_width, popup_height);

    frame.render_widget(Clear, popup_area);

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(theme::GREEN))
        .title(Span::styled(" Session Summary ", Style::default().fg(theme::GREEN).bold()))
        .style(Style::default().bg(theme::BG_PANEL));

    let duration_s = app.duration_ms / 1000.0;

    let lines = vec![
        Line::from(""),
        Line::from(vec![
            Span::styled("  Status:     ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled("Complete", Style::default().fg(theme::GREEN).bold()),
        ]),
        Line::from(vec![
            Span::styled("  Duration:   ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled(format!("{:.1}s", duration_s), Style::default().fg(theme::TEXT)),
        ]),
        Line::from(vec![
            Span::styled("  Tool Calls: ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled(format!("{}", app.tool_calls), Style::default().fg(theme::TEXT)),
        ]),
        Line::from(vec![
            Span::styled("  Tokens:     ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled(format!("{}", app.tokens_used), Style::default().fg(theme::CYAN)),
        ]),
        Line::from(vec![
            Span::styled("  Bugs Found: ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled(
                format!("{}", app.bugs_found),
                Style::default().fg(if app.bugs_found > 0 { theme::RED } else { theme::TEXT }),
            ),
        ]),
        Line::from(vec![
            Span::styled("  Est. Cost:  ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled(
                format!("${:.4}", if app.estimated_cost_usd > 0.0 { app.estimated_cost_usd } else { app.tokens_used as f64 * 0.00003 }),
                Style::default().fg(theme::TEXT),
            ),
        ]),
        Line::from(""),
        if let Some(d) = &app.diagnosis {
            Line::from(vec![
                Span::styled("  Bug: ", Style::default().fg(theme::TEXT_DIM)),
                Span::styled(
                    format!("[{}] {}", d.severity, d.title),
                    Style::default().fg(theme::RED),
                ),
            ])
        } else {
            Line::from(Span::styled("  No bugs found", Style::default().fg(theme::GREEN)))
        },
        Line::from(""),
        Line::from(Span::styled(
            "  [S] Save report  [q] Quit  [Esc] Close",
            Style::default().fg(theme::TEXT_DIM),
        )),
    ];

    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .block(block),
        popup_area,
    );
}
