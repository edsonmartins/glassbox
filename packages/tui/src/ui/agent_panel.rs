use ratatui::prelude::*;
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};

use crate::app::{App, PanelId, SessionPhase};
use crate::theme;

pub fn render(frame: &mut Frame, area: Rect, app: &App) {
    let is_active = app.active_panel == PanelId::Agent;
    let border_color = if is_active { theme::BORDER_ACTIVE } else { theme::BORDER };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border_color))
        .title(Span::styled(" AI Agent ", Style::default().fg(theme::ACCENT)))
        .style(Style::default().bg(theme::BG_PANEL));

    let (dot_color, content_lines) = match app.phase {
        SessionPhase::Starting => (
            theme::ACCENT,
            vec![Line::from(Span::styled(
                "Configurando sessao de debug...",
                Style::default().fg(theme::TEXT),
            ))],
        ),
        SessionPhase::Waiting => (
            theme::ORANGE,
            vec![
                Line::from(Span::styled(
                    "Esperando excecao ser lancada...",
                    Style::default().fg(theme::TEXT),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    "App rodando. Aguardando breakpoint ou excecao.",
                    Style::default().fg(theme::TEXT_DIM),
                )),
            ],
        ),
        SessionPhase::Exception => (
            theme::RED,
            vec![Line::from(Span::styled(
                "Excecao capturada — iniciando analise...",
                Style::default().fg(theme::TEXT),
            ))],
        ),
        SessionPhase::Investigating => {
            let thought = app.agent_thinking.as_deref().unwrap_or("Investigando...");
            (
                theme::YELLOW,
                vec![Line::from(Span::styled(
                    thought,
                    Style::default().fg(theme::TEXT),
                ))],
            )
        }
        SessionPhase::Diagnosis => {
            if let Some(d) = &app.diagnosis {
                let severity_color = match d.severity.as_str() {
                    "CRITICAL" => theme::RED,
                    "HIGH" => theme::RED,
                    "MEDIUM" => theme::ORANGE,
                    _ => theme::YELLOW,
                };
                (
                    theme::RED,
                    vec![
                        Line::from(vec![
                            Span::styled(
                                format!("[{}] ", d.severity),
                                Style::default().fg(severity_color).bold(),
                            ),
                            Span::styled(&d.title, Style::default().fg(theme::TEXT_BRIGHT)),
                        ]),
                        Line::from(""),
                        Line::from(vec![
                            Span::styled("Root cause: ", Style::default().fg(theme::TEXT_DIM)),
                            Span::styled(&d.root_cause, Style::default().fg(theme::TEXT)),
                        ]),
                    ],
                )
            } else {
                (theme::RED, vec![Line::from("Diagnosis...")])
            }
        }
        SessionPhase::Fix => {
            if let Some(f) = &app.proposed_fix {
                (
                    theme::GREEN,
                    vec![
                        Line::from(vec![
                            Span::styled("Fix proposto ", Style::default().fg(theme::GREEN).bold()),
                            Span::styled(
                                format!("({:.0}% confidence)", f.confidence * 100.0),
                                Style::default().fg(theme::TEXT_DIM),
                            ),
                        ]),
                        Line::from(""),
                        Line::from(Span::styled(&f.explanation, Style::default().fg(theme::TEXT))),
                        Line::from(""),
                        Line::from(Span::styled(
                            "[A] Apply  [D] Discard",
                            Style::default().fg(theme::TEXT_DIM),
                        )),
                    ],
                )
            } else {
                (theme::GREEN, vec![Line::from("Fix proposto")])
            }
        }
        SessionPhase::Complete => (
            theme::GREEN,
            vec![
                Line::from(Span::styled(
                    "Sessao finalizada com sucesso",
                    Style::default().fg(theme::GREEN),
                )),
                Line::from(""),
                Line::from(Span::styled(
                    format!("{} tokens | {} tool calls | {} bugs",
                        app.tokens_used, app.tool_calls, app.bugs_found),
                    Style::default().fg(theme::TEXT_DIM),
                )),
            ],
        ),
    };

    // Build lines with pulsing dot prefix on first line
    let is_active_phase = matches!(app.phase,
        SessionPhase::Waiting | SessionPhase::Investigating | SessionPhase::Starting);
    let dot_char = if is_active_phase && !app.dot_visible() { "○ " } else { "● " };

    let mut all_lines = Vec::new();
    for (i, line) in content_lines.into_iter().enumerate() {
        if i == 0 {
            let mut spans = vec![
                Span::styled("  ", Style::default()),
                Span::styled(dot_char, Style::default().fg(dot_color)),
            ];
            spans.extend(line.spans);
            all_lines.push(Line::from(spans));
        } else {
            let mut spans = vec![Span::raw("    ")];
            spans.extend(line.spans);
            all_lines.push(Line::from(spans));
        }
    }

    frame.render_widget(
        Paragraph::new(all_lines)
            .wrap(Wrap { trim: false })
            .block(block),
        area,
    );
}
