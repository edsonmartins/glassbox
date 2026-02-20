use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, PanelId};
use crate::theme;

pub fn render(frame: &mut Frame, stack_area: Rect, threads_area: Rect, app: &App) {
    let is_active = app.active_panel == PanelId::SideInfo;
    let border_color = if is_active { theme::BORDER_ACTIVE } else { theme::BORDER };

    render_call_stack(frame, stack_area, app, border_color);
    render_threads(frame, threads_area, app, border_color);
}

fn render_call_stack(frame: &mut Frame, area: Rect, app: &App, border_color: Color) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(" Call Stack ", Style::default().fg(theme::ACCENT)))
        .style(Style::default().bg(theme::BG_PANEL));

    if app.call_stack.is_empty() {
        frame.render_widget(
            Paragraph::new(Span::styled(" (empty)", Style::default().fg(theme::TEXT_DIM)))
                .block(block),
            area,
        );
        return;
    }

    let lines: Vec<Line> = app.call_stack.iter().enumerate().map(|(i, f)| {
        let marker = if i == 0 { "> " } else { "  " };
        let style = if i == 0 {
            Style::default().fg(theme::ORANGE)
        } else if f.is_user_code {
            Style::default().fg(theme::TEXT)
        } else {
            Style::default().fg(theme::TEXT_DIM)
        };

        let file_info = match &f.file {
            Some(file) => format!(" ({}:{})", file, f.line),
            None => " (native)".to_string(),
        };

        Line::from(vec![
            Span::styled(marker, Style::default().fg(theme::ORANGE)),
            Span::styled(format!("{}.{}", f.class, f.method), style),
            Span::styled(file_info, Style::default().fg(theme::TEXT_DIM)),
        ])
    }).collect();

    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn render_threads(frame: &mut Frame, area: Rect, app: &App, border_color: Color) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(" Threads ", Style::default().fg(theme::ACCENT)))
        .style(Style::default().bg(theme::BG_PANEL));

    if app.threads.is_empty() {
        frame.render_widget(
            Paragraph::new(Span::styled(" (empty)", Style::default().fg(theme::TEXT_DIM)))
                .block(block),
            area,
        );
        return;
    }

    let lines: Vec<Line> = app.threads.iter().map(|t| {
        let dot_color = if t.is_suspended {
            theme::RED
        } else {
            match t.state.as_str() {
                "running" => theme::GREEN,
                "sleeping" | "waiting" | "cond. waiting" => theme::TEXT_DIM,
                _ => theme::YELLOW,
            }
        };

        Line::from(vec![
            Span::styled(" ● ", Style::default().fg(dot_color)),
            Span::styled(&t.name, Style::default().fg(theme::TEXT)),
            Span::styled(format!(" [{}]", t.state), Style::default().fg(theme::TEXT_DIM)),
        ])
    }).collect();

    frame.render_widget(Paragraph::new(lines).block(block), area);
}
