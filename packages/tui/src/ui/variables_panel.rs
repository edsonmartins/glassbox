use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, PanelId};
use crate::theme;

pub fn render(frame: &mut Frame, area: Rect, app: &App) {
    let is_active = app.active_panel == PanelId::Variables;
    let border_color = if is_active { theme::BORDER_ACTIVE } else { theme::BORDER };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(" Variables ", Style::default().fg(theme::ACCENT)))
        .style(Style::default().bg(theme::BG_PANEL));

    if app.variables.is_empty() && app.watch_expressions.is_empty() {
        let text = Paragraph::new(Span::styled(
            "  (awaiting breakpoint)",
            Style::default().fg(theme::TEXT_DIM),
        ))
        .block(block);
        frame.render_widget(text, area);
        return;
    }

    let visible_lines = area.height.saturating_sub(2) as usize;
    let offset = *app.scroll_offsets.get(&PanelId::Variables).unwrap_or(&0);

    let mut lines: Vec<Line> = Vec::new();

    for (i, v) in app.variables.iter().enumerate() {
        let is_alert = v.alert.unwrap_or(false) || v.is_null;
        let is_selected = is_active && i == app.selected_var_index;
        let is_expanded = app.expanded_vars.contains(&v.name);

        let name_style = if is_alert {
            Style::default().fg(theme::RED)
        } else {
            Style::default().fg(theme::PURPLE)
        };
        let val_style = if v.is_null {
            Style::default().fg(theme::RED)
        } else {
            Style::default().fg(theme::CYAN)
        };

        // Selection cursor
        let cursor = if is_selected { "▸ " } else { "  " };
        let cursor_style = if is_selected {
            Style::default().fg(theme::ORANGE).bold()
        } else {
            Style::default()
        };

        // Expand indicator for expandable vars
        let expand_marker = if v.expandable {
            if is_expanded { "▾ " } else { "▸ " }
        } else {
            "  "
        };

        let bg = if is_selected { theme::LINE_HIGHLIGHT } else { theme::BG_PANEL };

        let mut spans = vec![
            Span::styled(cursor, cursor_style),
            Span::styled(expand_marker, Style::default().fg(theme::TEXT_DIM)),
            Span::styled(&v.name, name_style.bg(bg)),
            Span::styled(format!(" ({}) ", v.type_name), Style::default().fg(theme::TEXT_DIM).bg(bg)),
            Span::styled(&v.value, val_style.bg(bg)),
        ];
        if is_alert {
            spans.push(Span::styled(" !", Style::default().fg(theme::RED).bold().bg(bg)));
        }
        lines.push(Line::from(spans));

        // Expanded: show full value (multi-line)
        if is_expanded && v.expandable {
            for val_line in v.value.lines() {
                lines.push(Line::from(vec![
                    Span::raw("      "),
                    Span::styled(val_line, Style::default().fg(theme::CYAN)),
                ]));
            }
        }
    }

    // Watch expressions section
    if !app.watch_expressions.is_empty() {
        lines.push(Line::from(Span::styled(
            "  ── Watch ──",
            Style::default().fg(theme::TEXT_DIM),
        )));
        let var_count = app.variables.len();
        for (i, w) in app.watch_expressions.iter().enumerate() {
            let is_selected = is_active && (var_count + i) == app.selected_var_index;
            let cursor = if is_selected { "▸ " } else { "  " };
            let cursor_style = if is_selected {
                Style::default().fg(theme::ORANGE).bold()
            } else {
                Style::default()
            };
            let bg = if is_selected { theme::LINE_HIGHLIGHT } else { theme::BG_PANEL };
            let val_text = w.value.as_deref().unwrap_or("(pending)");
            let val_color = if w.value.is_some() { theme::CYAN } else { theme::TEXT_DIM };

            lines.push(Line::from(vec![
                Span::styled(cursor, cursor_style),
                Span::styled("  ", Style::default()),
                Span::styled(&w.expression, Style::default().fg(theme::PURPLE).bg(bg)),
                Span::styled(" = ", Style::default().fg(theme::TEXT_DIM).bg(bg)),
                Span::styled(val_text, Style::default().fg(val_color).bg(bg)),
            ]));
        }
    }

    // Apply scroll offset
    let visible: Vec<Line> = lines.into_iter()
        .skip(offset)
        .take(visible_lines)
        .collect();

    frame.render_widget(Paragraph::new(visible).block(block), area);
}
