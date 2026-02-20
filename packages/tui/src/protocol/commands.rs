use serde::Serialize;

/// Commands sent from the TUI back to the MCP server.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename = "command")]
pub struct TuiCommand {
    pub action: CommandAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandAction {
    Continue,
    StepOver,
    StepInto,
    StepOut,
    ToggleBreakpoint,
    Evaluate,
    ToggleControl,
    ApplyFix,
    DiscardFix,
    SaveReport,
}

impl TuiCommand {
    pub fn simple(action: CommandAction) -> Self {
        Self { action, args: None }
    }

    pub fn with_args(action: CommandAction, args: serde_json::Value) -> Self {
        Self { action, args: Some(args) }
    }
}
