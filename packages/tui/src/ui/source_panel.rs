use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::app::{App, PanelId, SessionPhase};
use crate::theme;
use super::syntax;

pub fn render(frame: &mut Frame, area: Rect, app: &App) {
    let is_active = app.active_panel == PanelId::Source;
    let border_color = if is_active { theme::BORDER_ACTIVE } else { theme::BORDER };

    let title = if app.proposed_fix.is_some() && app.phase == SessionPhase::Fix {
        " Source [DIFF] "
    } else {
        " Source "
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(title, Style::default().fg(theme::ACCENT)))
        .style(Style::default().bg(theme::BG_PANEL));

    // Check if we should show diff mode
    if let Some(fix) = &app.proposed_fix {
        if app.phase == SessionPhase::Fix {
            render_diff(frame, area, block, fix);
            return;
        }
    }

    // If we have source lines from debug/source, render them
    if let Some(sr) = &app.source_result {
        render_source_lines(frame, area, block, sr, app);
        return;
    }

    // Fallback — show location info
    let content = if let Some(loc) = &app.current_location {
        let mut lines = vec![
            Line::from(""),
            Line::from(vec![
                Span::styled("  File: ", Style::default().fg(theme::TEXT_DIM)),
                Span::styled(&loc.file, Style::default().fg(theme::TEXT_BRIGHT)),
            ]),
            Line::from(vec![
                Span::styled("  Line: ", Style::default().fg(theme::TEXT_DIM)),
                Span::styled(format!("{}", loc.line), Style::default().fg(theme::ORANGE)),
            ]),
            Line::from(vec![
                Span::styled("  Method: ", Style::default().fg(theme::TEXT_DIM)),
                Span::styled(
                    format!("{}.{}", loc.class, loc.method),
                    Style::default().fg(theme::PURPLE),
                ),
            ]),
            Line::from(""),
            Line::from(Span::styled(
                "  (Source code will be shown when debug/source is called)",
                Style::default().fg(theme::TEXT_DIM),
            )),
        ];

        // Show exception marker if in Exception phase
        if app.phase == SessionPhase::Exception || app.phase == SessionPhase::Investigating {
            lines.insert(1, Line::from(vec![
                Span::styled("  ! ", Style::default().fg(theme::RED).bold()),
                Span::styled("Exception at this location", Style::default().fg(theme::RED)),
            ]));
        }

        lines
    } else {
        vec![
            Line::from(""),
            Line::from(Span::styled(
                "  No source loaded",
                Style::default().fg(theme::TEXT_DIM),
            )),
            Line::from(""),
            Line::from(Span::styled(
                "  Pipe JSONL events to see the debugger in action:",
                Style::default().fg(theme::TEXT_DIM),
            )),
            Line::from(Span::styled(
                "  cat session.jsonl | glassbox-tui --input stdin",
                Style::default().fg(theme::GREEN),
            )),
        ]
    };

    frame.render_widget(Paragraph::new(content).block(block), area);
}

fn render_source_lines(
    frame: &mut Frame,
    area: Rect,
    block: Block,
    sr: &crate::protocol::types::SourceResult,
    app: &App,
) {
    let visible_lines = area.height.saturating_sub(2) as usize; // borders
    let offset = *app.scroll_offsets.get(&PanelId::Source).unwrap_or(&0);

    let lines: Vec<Line> = sr.lines.iter()
        .skip(offset)
        .take(visible_lines)
        .map(|sl| {
            let is_current = sl.is_current.unwrap_or(false);
            let has_bp = sl.has_breakpoint.unwrap_or(false);

            // Breakpoint marker
            let bp_marker = if has_bp {
                Span::styled("◆ ", Style::default().fg(theme::RED))
            } else {
                Span::raw("  ")
            };

            // Line number
            let line_num = Span::styled(
                format!("{:>4} ", sl.n),
                Style::default().fg(theme::TEXT_DIM),
            );

            // Current line marker
            let cursor = if is_current {
                Span::styled("▸ ", Style::default().fg(theme::ORANGE).bold())
            } else {
                Span::raw("  ")
            };

            // Code text — with syntax highlighting
            let mut spans = vec![bp_marker, line_num, cursor];
            if is_current {
                // Current line: bright text on highlight background
                let highlighted = syntax::highlight_java(&sl.text);
                for mut s in highlighted {
                    s.style = s.style.bg(theme::LINE_HIGHLIGHT);
                    spans.push(s);
                }
            } else {
                spans.extend(syntax::highlight_java(&sl.text));
            }

            Line::from(spans)
        })
        .collect();

    frame.render_widget(Paragraph::new(lines).block(block), area);
}

fn render_diff(frame: &mut Frame, area: Rect, block: Block, fix: &crate::protocol::types::FixProposedData) {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("  File: ", Style::default().fg(theme::TEXT_DIM)),
            Span::styled(&fix.file, Style::default().fg(theme::TEXT_BRIGHT)),
        ]),
        Line::from(""),
    ];

    for diff_line in fix.diff.lines() {
        let (style, prefix) = if diff_line.starts_with("@@") {
            (Style::default().fg(theme::CYAN), "@@ ")
        } else if diff_line.starts_with('+') {
            (Style::default().fg(theme::GREEN).bg(theme::DIFF_ADD), "+ ")
        } else if diff_line.starts_with('-') {
            (Style::default().fg(theme::RED).bg(theme::DIFF_REMOVE), "- ")
        } else {
            (Style::default().fg(theme::TEXT), "  ")
        };

        let display_text = if diff_line.starts_with("@@") {
            diff_line
        } else if diff_line.starts_with('+') || diff_line.starts_with('-') {
            &diff_line[1..]
        } else {
            diff_line
        };

        lines.push(Line::from(vec![
            Span::styled(format!("  {}", prefix), style),
            Span::styled(display_text.to_string(), style),
        ]));
    }

    frame.render_widget(Paragraph::new(lines).block(block), area);
}
