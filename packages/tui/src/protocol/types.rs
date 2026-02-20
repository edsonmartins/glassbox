use serde::Deserialize;

// ── Shared Types ──

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    pub file: String,
    pub line: i64,
    pub class: String,
    pub method: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub value: String,
    #[serde(default)]
    pub is_null: bool,
    #[serde(default)]
    pub expandable: bool,
    #[serde(default)]
    pub alert: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackFrame {
    pub index: i64,
    pub class: String,
    pub method: String,
    pub file: Option<String>,
    pub line: i64,
    #[serde(default)]
    pub is_user_code: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInfo {
    pub id: String,
    pub name: String,
    pub state: String,
    #[serde(default)]
    pub is_suspended: bool,
    pub is_daemon: Option<bool>,
    pub frame_count: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLine {
    pub n: i64,
    pub text: String,
    pub is_current: Option<bool>,
    pub has_breakpoint: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceResult {
    pub file: String,
    pub start_line: i64,
    pub end_line: i64,
    pub current_line: i64,
    pub lines: Vec<SourceLine>,
}

// ── Event Source ──

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EventSource {
    Debugger,
    Ai,
    User,
    System,
}

// ── Event Data Types ──

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartedData {
    pub pid: i64,
    pub jdk_version: String,
    pub main_class: String,
    pub jdwp_port: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEndedData {
    pub duration_ms: f64,
    pub tool_calls: i64,
    pub tokens_used: i64,
    pub estimated_cost_usd: f64,
    pub bugs_found: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointHitData {
    pub breakpoint_id: String,
    pub location: SourceLocation,
    pub thread: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExceptionCaughtData {
    pub exception_type: String,
    pub message: Option<String>,
    pub location: SourceLocation,
    pub thread: String,
    pub is_caught: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepCompletedData {
    pub step_type: String,
    pub location: SourceLocation,
    pub thread: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ThreadEventData {
    pub thread: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActionData {
    pub tool: String,
    pub request: serde_json::Value,
    pub result: serde_json::Value,
    pub tokens_used: i64,
    pub duration_ms: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentThinkingData {
    pub thought: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosisData {
    pub bug_id: String,
    pub severity: String,
    pub title: String,
    pub root_cause: String,
    pub affected_location: SourceLocation,
    pub total_tokens: i64,
    pub elapsed_ms: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixProposedData {
    pub bug_id: String,
    pub fix_type: String,
    pub file: String,
    pub diff: String,
    pub explanation: String,
    pub confidence: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ControlChangeData {
    pub from: String,
    pub to: String,
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualStepData {
    pub action: String,
    pub location: SourceLocation,
    pub thread: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManualEvalData {
    pub expression: String,
    pub result: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixAppliedData {
    pub bug_id: String,
    pub applied: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AppOutputData {
    pub text: String,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorData {
    pub code: String,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointAddedData {
    pub breakpoint_id: String,
    pub file: String,
    pub line: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WatchAddedData {
    pub expression: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStartedData {
    pub pid: i64,
    pub main_class: String,
}

// ── GlassboxEvent (tagged union on "type") ──

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum GlassboxEvent {
    #[serde(rename = "session_started")]
    SessionStarted {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: SessionStartedData,
    },
    #[serde(rename = "session_ended")]
    SessionEnded {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: SessionEndedData,
    },
    #[serde(rename = "breakpoint_hit")]
    BreakpointHit {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: BreakpointHitData,
    },
    #[serde(rename = "exception_caught")]
    ExceptionCaught {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: ExceptionCaughtData,
    },
    #[serde(rename = "step_completed")]
    StepCompleted {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: StepCompletedData,
    },
    #[serde(rename = "thread_started")]
    ThreadStarted {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: ThreadEventData,
    },
    #[serde(rename = "thread_died")]
    ThreadDied {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: ThreadEventData,
    },
    #[serde(rename = "agent_action")]
    AgentAction {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: AgentActionData,
    },
    #[serde(rename = "agent_thinking")]
    AgentThinking {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: AgentThinkingData,
    },
    #[serde(rename = "diagnosis")]
    Diagnosis {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: DiagnosisData,
    },
    #[serde(rename = "fix_proposed")]
    FixProposed {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: FixProposedData,
    },
    #[serde(rename = "control_change")]
    ControlChange {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: ControlChangeData,
    },
    #[serde(rename = "manual_step")]
    ManualStep {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: ManualStepData,
    },
    #[serde(rename = "manual_eval")]
    ManualEval {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: ManualEvalData,
    },
    #[serde(rename = "fix_applied")]
    FixApplied {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: FixAppliedData,
    },
    #[serde(rename = "breakpoint_added")]
    BreakpointAdded {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: BreakpointAddedData,
    },
    #[serde(rename = "watch_added")]
    WatchAdded {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: WatchAddedData,
    },
    #[serde(rename = "app_started")]
    AppStarted {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: AppStartedData,
    },
    #[serde(rename = "app_stdout")]
    AppStdout {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: AppOutputData,
    },
    #[serde(rename = "app_stderr")]
    AppStderr {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: AppOutputData,
    },
    #[serde(rename = "error")]
    Error {
        ts: String,
        seq: u64,
        #[serde(rename = "sessionId")]
        session_id: String,
        src: EventSource,
        data: ErrorData,
    },
}

impl GlassboxEvent {
    pub fn ts(&self) -> &str {
        match self {
            Self::SessionStarted { ts, .. } => ts,
            Self::SessionEnded { ts, .. } => ts,
            Self::BreakpointHit { ts, .. } => ts,
            Self::ExceptionCaught { ts, .. } => ts,
            Self::StepCompleted { ts, .. } => ts,
            Self::ThreadStarted { ts, .. } => ts,
            Self::ThreadDied { ts, .. } => ts,
            Self::AgentAction { ts, .. } => ts,
            Self::AgentThinking { ts, .. } => ts,
            Self::Diagnosis { ts, .. } => ts,
            Self::FixProposed { ts, .. } => ts,
            Self::ControlChange { ts, .. } => ts,
            Self::ManualStep { ts, .. } => ts,
            Self::ManualEval { ts, .. } => ts,
            Self::FixApplied { ts, .. } => ts,
            Self::BreakpointAdded { ts, .. } => ts,
            Self::WatchAdded { ts, .. } => ts,
            Self::AppStarted { ts, .. } => ts,
            Self::AppStdout { ts, .. } => ts,
            Self::AppStderr { ts, .. } => ts,
            Self::Error { ts, .. } => ts,
        }
    }

    pub fn src(&self) -> &EventSource {
        match self {
            Self::SessionStarted { src, .. } => src,
            Self::SessionEnded { src, .. } => src,
            Self::BreakpointHit { src, .. } => src,
            Self::ExceptionCaught { src, .. } => src,
            Self::StepCompleted { src, .. } => src,
            Self::ThreadStarted { src, .. } => src,
            Self::ThreadDied { src, .. } => src,
            Self::AgentAction { src, .. } => src,
            Self::AgentThinking { src, .. } => src,
            Self::Diagnosis { src, .. } => src,
            Self::FixProposed { src, .. } => src,
            Self::ControlChange { src, .. } => src,
            Self::ManualStep { src, .. } => src,
            Self::ManualEval { src, .. } => src,
            Self::FixApplied { src, .. } => src,
            Self::BreakpointAdded { src, .. } => src,
            Self::WatchAdded { src, .. } => src,
            Self::AppStarted { src, .. } => src,
            Self::AppStdout { src, .. } => src,
            Self::AppStderr { src, .. } => src,
            Self::Error { src, .. } => src,
        }
    }

    pub fn type_name(&self) -> &str {
        match self {
            Self::SessionStarted { .. } => "session_started",
            Self::SessionEnded { .. } => "session_ended",
            Self::BreakpointHit { .. } => "breakpoint_hit",
            Self::ExceptionCaught { .. } => "exception_caught",
            Self::StepCompleted { .. } => "step_completed",
            Self::ThreadStarted { .. } => "thread_started",
            Self::ThreadDied { .. } => "thread_died",
            Self::AgentAction { .. } => "agent_action",
            Self::AgentThinking { .. } => "agent_thinking",
            Self::Diagnosis { .. } => "diagnosis",
            Self::FixProposed { .. } => "fix_proposed",
            Self::ControlChange { .. } => "control_change",
            Self::ManualStep { .. } => "manual_step",
            Self::ManualEval { .. } => "manual_eval",
            Self::FixApplied { .. } => "fix_applied",
            Self::BreakpointAdded { .. } => "breakpoint_added",
            Self::WatchAdded { .. } => "watch_added",
            Self::AppStarted { .. } => "app_started",
            Self::AppStdout { .. } => "app_stdout",
            Self::AppStderr { .. } => "app_stderr",
            Self::Error { .. } => "error",
        }
    }

    pub fn display_text(&self) -> String {
        match self {
            Self::SessionStarted { data, .. } => {
                format!("Session started: {} (pid {})", data.main_class, data.pid)
            }
            Self::SessionEnded { data, .. } => {
                format!("Session ended: {} tokens, {} bugs", data.tokens_used, data.bugs_found)
            }
            Self::BreakpointHit { data, .. } => {
                format!("Breakpoint hit: {}:{}", data.location.file, data.location.line)
            }
            Self::ExceptionCaught { data, .. } => {
                format!("{} at {}:{}", data.exception_type, data.location.file, data.location.line)
            }
            Self::StepCompleted { data, .. } => {
                format!("Step {}: {}:{}", data.step_type, data.location.file, data.location.line)
            }
            Self::ThreadStarted { data, .. } => format!("Thread started: {}", data.thread),
            Self::ThreadDied { data, .. } => format!("Thread died: {}", data.thread),
            Self::AgentAction { data, .. } => {
                format!("{} ({}tok)", data.tool, data.tokens_used)
            }
            Self::AgentThinking { data, .. } => data.thought.clone(),
            Self::Diagnosis { data, .. } => {
                format!("[{}] {}: {}", data.severity, data.title, data.root_cause)
            }
            Self::FixProposed { data, .. } => {
                format!("Fix proposed for {}: {}", data.file, data.explanation)
            }
            Self::ControlChange { data, .. } => {
                format!("Control: {} -> {} ({})", data.from, data.to, data.reason)
            }
            Self::ManualStep { data, .. } => {
                format!("Manual {}: {}:{}", data.action, data.location.file, data.location.line)
            }
            Self::ManualEval { data, .. } => {
                format!("eval {} = {}", data.expression, data.result)
            }
            Self::FixApplied { data, .. } => {
                format!("Fix {}: {}", data.bug_id, if data.applied { "applied" } else { "rejected" })
            }
            Self::BreakpointAdded { data, .. } => {
                format!("Breakpoint added: {}:{}", data.file, data.line)
            }
            Self::WatchAdded { data, .. } => {
                format!("Watch added: {}", data.expression)
            }
            Self::AppStarted { data, .. } => {
                format!("App started: {} (pid {})", data.main_class, data.pid)
            }
            Self::AppStdout { data, .. } => format!("[stdout] {}", data.text),
            Self::AppStderr { data, .. } => format!("[stderr] {}", data.text),
            Self::Error { data, .. } => format!("ERROR [{}]: {}", data.code, data.message),
        }
    }
}
