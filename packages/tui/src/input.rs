use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::app::{App, ControlMode, PanelId, SessionPhase};
use crate::protocol::commands::{CommandAction, TuiCommand};

/// Result of processing a key event.
pub enum Action {
    /// No action needed.
    None,
    /// Quit the application.
    Quit,
    /// Send a command to the MCP server.
    #[allow(dead_code)]
    SendCommand(TuiCommand),
}

/// Process a key event and return the resulting action.
pub fn handle_key(app: &mut App, key: KeyEvent) -> Action {
    // Help overlay captures Escape
    if app.show_help {
        match key.code {
            KeyCode::Esc | KeyCode::Char('?') | KeyCode::F(1) => {
                app.show_help = false;
                return Action::None;
            }
            _ => return Action::None,
        }
    }

    // Summary overlay captures Escape
    if app.show_summary {
        match key.code {
            KeyCode::Esc => {
                app.show_summary = false;
                return Action::None;
            }
            KeyCode::Char('q') => return Action::Quit,
            KeyCode::Char('s') | KeyCode::Char('S') => {
                // TODO: Save session report to file
                return Action::None;
            }
            _ => return Action::None,
        }
    }

    // Command prompt captures all keys when open
    if let Some(ref mut buf) = app.command_input {
        match key.code {
            KeyCode::Esc => {
                app.command_input = None;
                app.command_cursor = 0;
                return Action::None;
            }
            KeyCode::Enter => {
                let input = buf.clone();
                app.command_input = None;
                app.command_cursor = 0;
                return parse_command(&input, app);
            }
            KeyCode::Backspace => {
                if app.command_cursor > 0 {
                    buf.remove(app.command_cursor - 1);
                    app.command_cursor -= 1;
                }
                return Action::None;
            }
            KeyCode::Char(c) => {
                buf.insert(app.command_cursor, c);
                app.command_cursor += 1;
                return Action::None;
            }
            _ => return Action::None,
        }
    }

    match key.code {
        // ── Universal keys ──
        KeyCode::Char('q') => Action::Quit,
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => Action::Quit,
        KeyCode::Char('?') | KeyCode::F(1) => {
            app.show_help = !app.show_help;
            Action::None
        }

        // ── Navigation ──
        KeyCode::Tab => {
            app.cycle_panel();
            Action::None
        }
        KeyCode::Char('1') => { app.active_panel = PanelId::Source; Action::None }
        KeyCode::Char('2') => { app.active_panel = PanelId::Variables; Action::None }
        KeyCode::Char('3') => { app.active_panel = PanelId::Agent; Action::None }
        KeyCode::Char('4') => { app.active_panel = PanelId::SideInfo; Action::None }
        KeyCode::Char('5') => { app.active_panel = PanelId::EventLog; Action::None }
        KeyCode::Char('j') | KeyCode::Down => {
            if app.active_panel == PanelId::Variables && !app.variables.is_empty() {
                app.selected_var_index = (app.selected_var_index + 1).min(app.variables.len() - 1);
            } else {
                app.scroll_down();
            }
            Action::None
        }
        KeyCode::Char('k') | KeyCode::Up => {
            if app.active_panel == PanelId::Variables && !app.variables.is_empty() {
                app.selected_var_index = app.selected_var_index.saturating_sub(1);
            } else {
                app.scroll_up();
            }
            Action::None
        }
        KeyCode::Enter if app.active_panel == PanelId::Variables => {
            app.toggle_var_expand();
            Action::None
        }

        // ── Control mode toggle ──
        KeyCode::Char('r') | KeyCode::Char('R') => {
            app.control_mode = match app.control_mode {
                ControlMode::Autonomous => ControlMode::Manual,
                ControlMode::Manual => ControlMode::Autonomous,
                ControlMode::Collaborative => ControlMode::Autonomous,
            };
            Action::None
        }

        // ── Debug actions (Manual/Collaborative only) ──
        KeyCode::F(5) if app.can_user_act() => {
            Action::SendCommand(TuiCommand::simple(CommandAction::Continue))
        }
        KeyCode::F(9) if app.can_user_act() => {
            Action::SendCommand(TuiCommand::simple(CommandAction::ToggleBreakpoint))
        }
        KeyCode::F(10) if app.can_user_act() => {
            Action::SendCommand(TuiCommand::simple(CommandAction::StepOver))
        }
        KeyCode::F(11) if app.can_user_act() => {
            Action::SendCommand(TuiCommand::simple(CommandAction::StepInto))
        }
        KeyCode::F(12) if app.can_user_act() => {
            Action::SendCommand(TuiCommand::simple(CommandAction::StepOut))
        }

        // ── Fix actions ──
        KeyCode::Char('a') | KeyCode::Char('A') if app.proposed_fix.is_some() => {
            Action::SendCommand(TuiCommand::simple(CommandAction::ApplyFix))
        }
        KeyCode::Char('d') | KeyCode::Char('D') if app.proposed_fix.is_some() => {
            Action::SendCommand(TuiCommand::simple(CommandAction::DiscardFix))
        }

        // ── Session actions ──
        KeyCode::Char('s') | KeyCode::Char('S') if app.phase == SessionPhase::Complete => {
            Action::SendCommand(TuiCommand::simple(CommandAction::SaveReport))
        }

        // ── Command prompt ──
        KeyCode::Char('/') => {
            app.command_input = Some(String::new());
            app.command_cursor = 0;
            Action::None
        }

        // ── Watch expressions ──
        KeyCode::Char('w') if app.active_panel == PanelId::Variables && app.can_user_act() => {
            // Open command prompt pre-filled with "watch "
            app.command_input = Some("watch ".to_string());
            app.command_cursor = 6;
            Action::None
        }
        KeyCode::Char('x') if app.active_panel == PanelId::Variables => {
            // Remove the selected watch expression
            let var_count = app.variables.len();
            let watch_idx = app.selected_var_index.saturating_sub(var_count);
            if app.selected_var_index >= var_count && watch_idx < app.watch_expressions.len() {
                app.remove_watch(watch_idx);
            }
            Action::None
        }

        _ => Action::None,
    }
}

/// Parse a command string from the command prompt and return an Action.
fn parse_command(input: &str, app: &mut App) -> Action {
    let input = input.trim();
    if input.is_empty() {
        return Action::None;
    }

    let (cmd, rest) = match input.split_once(' ') {
        Some((c, r)) => (c, r.trim()),
        None => (input, ""),
    };

    match cmd {
        "eval" | "inspect" if !rest.is_empty() => {
            Action::SendCommand(TuiCommand::with_args(
                CommandAction::Evaluate,
                serde_json::json!({ "expression": rest }),
            ))
        }
        "watch" if !rest.is_empty() => {
            app.add_watch(rest.to_string());
            // Also send an evaluate command to get initial value
            Action::SendCommand(TuiCommand::with_args(
                CommandAction::Evaluate,
                serde_json::json!({ "expression": rest }),
            ))
        }
        "bp" if !rest.is_empty() => {
            // Parse "file:line" format
            if let Some((file, line_str)) = rest.rsplit_once(':') {
                if let Ok(line) = line_str.parse::<i64>() {
                    return Action::SendCommand(TuiCommand::with_args(
                        CommandAction::ToggleBreakpoint,
                        serde_json::json!({ "file": file, "line": line }),
                    ));
                }
            }
            Action::None
        }
        _ => Action::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::KeyEventKind;

    fn make_key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn make_key_press(code: KeyCode) -> KeyEvent {
        KeyEvent {
            code,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Press,
            state: crossterm::event::KeyEventState::NONE,
        }
    }

    #[test]
    fn quit_on_q() {
        let mut app = App::new();
        assert!(matches!(handle_key(&mut app, make_key(KeyCode::Char('q'))), Action::Quit));
    }

    #[test]
    fn toggle_help() {
        let mut app = App::new();
        assert!(!app.show_help);
        handle_key(&mut app, make_key(KeyCode::Char('?')));
        assert!(app.show_help);
        // While help is open, ? closes it
        handle_key(&mut app, make_key(KeyCode::Char('?')));
        assert!(!app.show_help);
    }

    #[test]
    fn tab_cycles_panel() {
        let mut app = App::new();
        assert_eq!(app.active_panel, PanelId::Source);
        handle_key(&mut app, make_key(KeyCode::Tab));
        assert_eq!(app.active_panel, PanelId::Variables);
    }

    #[test]
    fn number_keys_select_panel() {
        let mut app = App::new();
        handle_key(&mut app, make_key(KeyCode::Char('3')));
        assert_eq!(app.active_panel, PanelId::Agent);
        handle_key(&mut app, make_key(KeyCode::Char('5')));
        assert_eq!(app.active_panel, PanelId::EventLog);
    }

    #[test]
    fn r_toggles_control_mode() {
        let mut app = App::new();
        assert_eq!(app.control_mode, ControlMode::Autonomous);
        handle_key(&mut app, make_key(KeyCode::Char('r')));
        assert_eq!(app.control_mode, ControlMode::Manual);
        handle_key(&mut app, make_key(KeyCode::Char('r')));
        assert_eq!(app.control_mode, ControlMode::Autonomous);
    }

    #[test]
    fn f5_blocked_in_autonomous() {
        let mut app = App::new();
        let action = handle_key(&mut app, make_key(KeyCode::F(5)));
        assert!(matches!(action, Action::None));
    }

    #[test]
    fn f5_sends_command_in_manual() {
        let mut app = App::new();
        app.control_mode = ControlMode::Manual;
        let action = handle_key(&mut app, make_key(KeyCode::F(5)));
        assert!(matches!(action, Action::SendCommand(_)));
    }

    #[test]
    fn f10_sends_command_in_collaborative() {
        let mut app = App::new();
        app.control_mode = ControlMode::Collaborative;
        let action = handle_key(&mut app, make_key(KeyCode::F(10)));
        assert!(matches!(action, Action::SendCommand(_)));
    }

    #[test]
    fn apply_fix_only_when_proposed() {
        let mut app = App::new();
        // No fix proposed — A does nothing
        let action = handle_key(&mut app, make_key(KeyCode::Char('a')));
        assert!(matches!(action, Action::None));

        // With fix proposed — A sends command
        app.proposed_fix = Some(crate::protocol::types::FixProposedData {
            bug_id: "NPE-001".into(),
            fix_type: "code_change".into(),
            file: "Test.java".into(),
            diff: String::new(),
            explanation: "test".into(),
            confidence: 0.9,
        });
        let action = handle_key(&mut app, make_key(KeyCode::Char('a')));
        assert!(matches!(action, Action::SendCommand(_)));
    }

    #[test]
    fn save_only_when_complete() {
        let mut app = App::new();
        let action = handle_key(&mut app, make_key(KeyCode::Char('s')));
        assert!(matches!(action, Action::None));

        app.phase = crate::app::SessionPhase::Complete;
        let action = handle_key(&mut app, make_key(KeyCode::Char('s')));
        assert!(matches!(action, Action::SendCommand(_)));
    }

    #[test]
    fn help_overlay_captures_keys() {
        let mut app = App::new();
        app.show_help = true;
        // While help is open, Tab should NOT cycle panel
        let panel_before = app.active_panel;
        handle_key(&mut app, make_key(KeyCode::Tab));
        assert_eq!(app.active_panel, panel_before);
        assert!(app.show_help); // still open
        // Esc closes help
        handle_key(&mut app, make_key(KeyCode::Esc));
        assert!(!app.show_help);
    }

    #[test]
    fn jk_scrolls() {
        let mut app = App::new();
        handle_key(&mut app, make_key_press(KeyCode::Char('j')));
        assert_eq!(*app.scroll_offsets.get(&PanelId::Source).unwrap_or(&0), 1);
        handle_key(&mut app, make_key_press(KeyCode::Char('k')));
        assert_eq!(*app.scroll_offsets.get(&PanelId::Source).unwrap_or(&0), 0);
    }

    #[test]
    fn jk_moves_var_selection_in_variables_panel() {
        let mut app = App::new();
        app.active_panel = PanelId::Variables;
        app.variables = vec![
            crate::protocol::types::Variable {
                name: "a".into(), type_name: "int".into(), value: "1".into(),
                is_null: false, expandable: false, alert: None,
            },
            crate::protocol::types::Variable {
                name: "b".into(), type_name: "int".into(), value: "2".into(),
                is_null: false, expandable: false, alert: None,
            },
        ];
        assert_eq!(app.selected_var_index, 0);
        handle_key(&mut app, make_key_press(KeyCode::Char('j')));
        assert_eq!(app.selected_var_index, 1);
        // Should not go past last item
        handle_key(&mut app, make_key_press(KeyCode::Char('j')));
        assert_eq!(app.selected_var_index, 1);
        handle_key(&mut app, make_key_press(KeyCode::Char('k')));
        assert_eq!(app.selected_var_index, 0);
    }

    #[test]
    fn enter_toggles_var_expand() {
        let mut app = App::new();
        app.active_panel = PanelId::Variables;
        app.variables = vec![
            crate::protocol::types::Variable {
                name: "obj".into(), type_name: "Object".into(), value: "{x:1}".into(),
                is_null: false, expandable: true, alert: None,
            },
        ];
        app.selected_var_index = 0;
        assert!(!app.expanded_vars.contains("obj"));
        handle_key(&mut app, make_key(KeyCode::Enter));
        assert!(app.expanded_vars.contains("obj"));
        handle_key(&mut app, make_key(KeyCode::Enter));
        assert!(!app.expanded_vars.contains("obj"));
    }

    // ── Fase 12: Command prompt + Watch expressions ──

    #[test]
    fn slash_opens_command_prompt() {
        let mut app = App::new();
        assert!(app.command_input.is_none());
        handle_key(&mut app, make_key(KeyCode::Char('/')));
        assert!(app.command_input.is_some());
        assert_eq!(app.command_input.as_deref(), Some(""));
    }

    #[test]
    fn command_prompt_captures_typing() {
        let mut app = App::new();
        app.command_input = Some(String::new());
        app.command_cursor = 0;
        handle_key(&mut app, make_key(KeyCode::Char('e')));
        handle_key(&mut app, make_key(KeyCode::Char('v')));
        assert_eq!(app.command_input.as_deref(), Some("ev"));
        assert_eq!(app.command_cursor, 2);
    }

    #[test]
    fn command_prompt_backspace_deletes() {
        let mut app = App::new();
        app.command_input = Some("abc".to_string());
        app.command_cursor = 3;
        handle_key(&mut app, make_key(KeyCode::Backspace));
        assert_eq!(app.command_input.as_deref(), Some("ab"));
        assert_eq!(app.command_cursor, 2);
    }

    #[test]
    fn command_prompt_esc_closes() {
        let mut app = App::new();
        app.command_input = Some("eval x".to_string());
        app.command_cursor = 6;
        handle_key(&mut app, make_key(KeyCode::Esc));
        assert!(app.command_input.is_none());
    }

    #[test]
    fn command_prompt_eval_sends_command() {
        let mut app = App::new();
        app.command_input = Some("eval dto.getId()".to_string());
        app.command_cursor = 16;
        let action = handle_key(&mut app, make_key(KeyCode::Enter));
        assert!(matches!(action, Action::SendCommand(_)));
        assert!(app.command_input.is_none());
    }

    #[test]
    fn command_prompt_watch_adds_expression() {
        let mut app = App::new();
        app.command_input = Some("watch dto.getId()".to_string());
        app.command_cursor = 17;
        let action = handle_key(&mut app, make_key(KeyCode::Enter));
        assert!(matches!(action, Action::SendCommand(_)));
        assert_eq!(app.watch_expressions.len(), 1);
        assert_eq!(app.watch_expressions[0].expression, "dto.getId()");
        assert!(app.watch_expressions[0].value.is_none());
    }

    #[test]
    fn watch_add_and_remove() {
        let mut app = App::new();
        app.add_watch("x".to_string());
        app.add_watch("y".to_string());
        assert_eq!(app.watch_expressions.len(), 2);
        app.remove_watch(0);
        assert_eq!(app.watch_expressions.len(), 1);
        assert_eq!(app.watch_expressions[0].expression, "y");
    }

    #[test]
    fn command_prompt_bp_sends_command() {
        let mut app = App::new();
        app.command_input = Some("bp App.java:42".to_string());
        app.command_cursor = 14;
        let action = handle_key(&mut app, make_key(KeyCode::Enter));
        assert!(matches!(action, Action::SendCommand(_)));
    }
}
