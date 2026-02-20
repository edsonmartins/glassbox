use std::collections::{HashMap, HashSet};

use crate::protocol::types::*;

// ── TUI Phase (maps to prototype's 7 visual states) ──

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SessionPhase {
    Starting,
    Waiting,
    Exception,
    Investigating,
    Diagnosis,
    Fix,
    Complete,
}

impl std::fmt::Display for SessionPhase {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Starting => write!(f, "Starting"),
            Self::Waiting => write!(f, "Waiting"),
            Self::Exception => write!(f, "Exception"),
            Self::Investigating => write!(f, "Investigating"),
            Self::Diagnosis => write!(f, "Diagnosis"),
            Self::Fix => write!(f, "Fix"),
            Self::Complete => write!(f, "Complete"),
        }
    }
}

// ── Control Mode ──

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ControlMode {
    Autonomous,
    Manual,
    Collaborative,
}

impl std::fmt::Display for ControlMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Autonomous => write!(f, "AI"),
            Self::Manual => write!(f, "Manual"),
            Self::Collaborative => write!(f, "Collaborative"),
        }
    }
}

// ── Connection Status ──

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ConnectionStatus {
    /// No socket connection (using stdin pipe)
    PipeMode,
    /// Attempting to connect to socket
    Connecting,
    /// Connected to MCP server via socket
    Connected,
    /// Socket connection lost
    Disconnected,
}

// ── Panel ID ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PanelId {
    Source,
    Variables,
    Agent,
    SideInfo,
    EventLog,
}

impl PanelId {
    pub fn next(self) -> Self {
        match self {
            Self::Source => Self::Variables,
            Self::Variables => Self::Agent,
            Self::Agent => Self::SideInfo,
            Self::SideInfo => Self::EventLog,
            Self::EventLog => Self::Source,
        }
    }

    pub fn from_number(n: u8) -> Option<Self> {
        match n {
            1 => Some(Self::Source),
            2 => Some(Self::Variables),
            3 => Some(Self::Agent),
            4 => Some(Self::SideInfo),
            5 => Some(Self::EventLog),
            _ => None,
        }
    }
}

// ── Watch Entry ──

#[derive(Debug, Clone)]
pub struct WatchEntry {
    pub expression: String,
    pub value: Option<String>,
}

// ── Event Log Entry ──

#[derive(Debug, Clone)]
pub struct EventLogEntry {
    pub ts: String,
    pub src: EventSource,
    pub text: String,
}

// ── App State ──

pub struct App {
    // Session
    pub phase: SessionPhase,
    pub control_mode: ControlMode,
    pub session_id: Option<String>,
    pub main_class: String,

    // Debug
    pub variables: Vec<Variable>,
    pub call_stack: Vec<StackFrame>,
    pub threads: Vec<ThreadInfo>,
    pub current_location: Option<SourceLocation>,

    // Source
    pub source_result: Option<SourceResult>,

    // AI
    pub agent_thinking: Option<String>,
    pub diagnosis: Option<DiagnosisData>,
    pub proposed_fix: Option<FixProposedData>,

    // Variables
    pub expanded_vars: HashSet<String>,
    pub selected_var_index: usize,
    pub watch_expressions: Vec<WatchEntry>,

    // Command prompt
    pub command_input: Option<String>,
    pub command_cursor: usize,

    // UI
    pub active_panel: PanelId,
    pub event_log: Vec<EventLogEntry>,
    pub scroll_offsets: HashMap<PanelId, usize>,
    pub auto_scroll: bool,
    pub show_help: bool,
    pub show_summary: bool,
    pub terminal_size: (u16, u16),

    // Metrics
    pub tokens_used: u64,
    pub tool_calls: u64,
    pub bugs_found: u32,
    pub duration_ms: f64,
    pub estimated_cost_usd: f64,

    // Timeline (key event timestamps for compact display)
    pub event_timestamps: Vec<(String, String)>,

    // Animation
    pub tick_count: u64,
    pub parse_errors: u32,

    // Connection
    pub connection_status: ConnectionStatus,
}

impl App {
    pub fn new() -> Self {
        Self {
            phase: SessionPhase::Starting,
            control_mode: ControlMode::Autonomous,
            session_id: None,
            main_class: String::new(),
            variables: Vec::new(),
            call_stack: Vec::new(),
            threads: Vec::new(),
            current_location: None,
            source_result: None,
            agent_thinking: None,
            diagnosis: None,
            proposed_fix: None,
            expanded_vars: HashSet::new(),
            selected_var_index: 0,
            watch_expressions: Vec::new(),
            command_input: None,
            command_cursor: 0,
            active_panel: PanelId::Source,
            event_log: Vec::new(),
            scroll_offsets: HashMap::new(),
            auto_scroll: true,
            show_help: false,
            show_summary: false,
            terminal_size: (120, 40),
            tokens_used: 0,
            tool_calls: 0,
            bugs_found: 0,
            duration_ms: 0.0,
            estimated_cost_usd: 0.0,
            event_timestamps: Vec::new(),
            tick_count: 0,
            parse_errors: 0,
            connection_status: ConnectionStatus::PipeMode,
        }
    }

    /// Advance tick counter (called on Tick events for animations).
    pub fn tick(&mut self) {
        self.tick_count = self.tick_count.wrapping_add(1);
    }

    /// Returns true if the pulsing dot should be "on" (500ms cycle).
    pub fn dot_visible(&self) -> bool {
        // Tick fires every ~100ms, so 5 ticks = 500ms half-cycle
        (self.tick_count / 5) % 2 == 0
    }

    pub fn can_user_act(&self) -> bool {
        matches!(self.control_mode, ControlMode::Manual | ControlMode::Collaborative)
    }

    pub fn toggle_var_expand(&mut self) {
        if self.selected_var_index < self.variables.len() {
            let name = self.variables[self.selected_var_index].name.clone();
            if !self.expanded_vars.remove(&name) {
                self.expanded_vars.insert(name);
            }
        }
    }

    pub fn add_watch(&mut self, expression: String) {
        if !expression.is_empty() {
            self.watch_expressions.push(WatchEntry {
                expression,
                value: None,
            });
        }
    }

    pub fn remove_watch(&mut self, index: usize) {
        if index < self.watch_expressions.len() {
            self.watch_expressions.remove(index);
        }
    }

    pub fn cycle_panel(&mut self) {
        self.active_panel = self.active_panel.next();
    }

    pub fn scroll_down(&mut self) {
        let offset = self.scroll_offsets.entry(self.active_panel).or_insert(0);
        *offset = offset.saturating_add(1);
        if self.active_panel == PanelId::EventLog {
            self.auto_scroll = false;
        }
    }

    pub fn scroll_up(&mut self) {
        let offset = self.scroll_offsets.entry(self.active_panel).or_insert(0);
        *offset = offset.saturating_sub(1);
        if self.active_panel == PanelId::EventLog {
            self.auto_scroll = false;
        }
    }

    pub fn add_parse_error(&mut self, msg: String) {
        self.event_log.push(EventLogEntry {
            ts: "??:??:??".to_string(),
            src: EventSource::System,
            text: msg,
        });
    }

    fn add_log(&mut self, ts: &str, src: &EventSource, text: String) {
        self.event_log.push(EventLogEntry {
            ts: extract_time(ts),
            src: src.clone(),
            text,
        });
        if self.auto_scroll {
            // Keep event log scrolled to bottom
            let len = self.event_log.len();
            self.scroll_offsets.insert(PanelId::EventLog, len.saturating_sub(1));
        }
    }

    /// Apply a GlassboxEvent to update app state.
    pub fn apply_event(&mut self, ev: GlassboxEvent) {
        match ev {
            GlassboxEvent::SessionStarted { ts, session_id, src, data, .. } => {
                self.session_id = Some(session_id);
                self.main_class = data.main_class.clone();
                self.phase = SessionPhase::Waiting;
                self.tokens_used = 0;
                self.tool_calls = 0;
                self.bugs_found = 0;
                self.variables.clear();
                self.call_stack.clear();
                self.threads.clear();
                self.diagnosis = None;
                self.proposed_fix = None;
                self.agent_thinking = None;
                self.add_log(&ts, &src, format!("Session started: {} (pid {})", data.main_class, data.pid));
            }

            GlassboxEvent::SessionEnded { ts, src, data, .. } => {
                self.phase = SessionPhase::Complete;
                self.duration_ms = data.duration_ms;
                self.estimated_cost_usd = data.estimated_cost_usd;
                self.show_summary = true;
                self.add_log(&ts, &src, format!(
                    "Session ended: {} tokens, {} bugs, {:.1}s",
                    data.tokens_used, data.bugs_found, data.duration_ms / 1000.0
                ));
            }

            GlassboxEvent::BreakpointHit { ts, src, data, .. } => {
                self.current_location = Some(data.location.clone());
                if self.phase == SessionPhase::Waiting {
                    self.phase = SessionPhase::Exception;
                }
                self.add_log(&ts, &src, format!(
                    "Breakpoint hit: {}:{}",
                    data.location.file, data.location.line
                ));
            }

            GlassboxEvent::ExceptionCaught { ts, src, data, .. } => {
                self.current_location = Some(data.location.clone());
                self.phase = SessionPhase::Exception;
                self.event_timestamps.push((extract_time(&ts), "exc".to_string()));
                self.add_log(&ts, &src, format!(
                    "{} at {}:{}",
                    data.exception_type, data.location.file, data.location.line
                ));
            }

            GlassboxEvent::StepCompleted { ts, src, data, .. } => {
                self.current_location = Some(data.location.clone());
                self.add_log(&ts, &src, format!(
                    "Step {}: {}:{}",
                    data.step_type, data.location.file, data.location.line
                ));
            }

            GlassboxEvent::ThreadStarted { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!("Thread started: {}", data.thread));
            }

            GlassboxEvent::ThreadDied { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!("Thread died: {}", data.thread));
            }

            GlassboxEvent::AgentAction { ts, src, data, .. } => {
                self.tokens_used += data.tokens_used as u64;
                self.tool_calls += 1;

                if self.phase == SessionPhase::Exception {
                    self.phase = SessionPhase::Investigating;
                }

                // Extract data from tool results
                match data.tool.as_str() {
                    "debug/locals" => {
                        if let Ok(vars) = serde_json::from_value::<Vec<Variable>>(data.result.clone()) {
                            self.variables = vars;
                        }
                    }
                    "debug/stacktrace" => {
                        if let Some(frames) = data.result.get("frames") {
                            if let Ok(f) = serde_json::from_value::<Vec<StackFrame>>(frames.clone()) {
                                self.call_stack = f;
                            }
                        }
                    }
                    "debug/threads" => {
                        if let Some(threads) = data.result.get("threads") {
                            if let Ok(t) = serde_json::from_value::<Vec<ThreadInfo>>(threads.clone()) {
                                self.threads = t;
                            }
                        }
                    }
                    "debug/source" => {
                        if let Ok(sr) = serde_json::from_value::<SourceResult>(data.result.clone()) {
                            self.source_result = Some(sr);
                        }
                    }
                    "debug/evaluate" => {
                        // Update watch expression values if expression matches
                        if let (Some(expr), Some(val)) = (
                            data.request.get("expression").and_then(|v| v.as_str()),
                            data.result.get("value").and_then(|v| v.as_str()),
                        ) {
                            for watch in &mut self.watch_expressions {
                                if watch.expression == expr {
                                    watch.value = Some(val.to_string());
                                }
                            }
                        }
                    }
                    _ => {}
                }

                self.add_log(&ts, &src, format!("{} ({}tok)", data.tool, data.tokens_used));
            }

            GlassboxEvent::AgentThinking { ts, src, data, .. } => {
                self.agent_thinking = Some(data.thought.clone());
                self.add_log(&ts, &src, data.thought);
            }

            GlassboxEvent::Diagnosis { ts, src, data, .. } => {
                self.phase = SessionPhase::Diagnosis;
                self.bugs_found += 1;
                self.event_timestamps.push((extract_time(&ts), "diag".to_string()));
                let text = format!("[{}] {}", data.severity, data.title);
                self.diagnosis = Some(data);
                self.add_log(&ts, &src, text);
            }

            GlassboxEvent::FixProposed { ts, src, data, .. } => {
                self.phase = SessionPhase::Fix;
                self.event_timestamps.push((extract_time(&ts), "fix".to_string()));
                let text = format!("Fix proposed: {}", data.explanation);
                self.proposed_fix = Some(data);
                self.add_log(&ts, &src, text);
            }

            GlassboxEvent::ControlChange { ts, src, data, .. } => {
                self.control_mode = match data.to.as_str() {
                    "user" => ControlMode::Manual,
                    "shared" => ControlMode::Collaborative,
                    _ => ControlMode::Autonomous,
                };
                self.add_log(&ts, &src, format!(
                    "Control: {} -> {} ({})",
                    data.from, data.to, data.reason
                ));
            }

            GlassboxEvent::ManualStep { ts, src, data, .. } => {
                self.current_location = Some(data.location.clone());
                self.add_log(&ts, &src, format!(
                    "Manual {}: {}:{}",
                    data.action, data.location.file, data.location.line
                ));
            }

            GlassboxEvent::ManualEval { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!("eval {} = {}", data.expression, data.result));
            }

            GlassboxEvent::FixApplied { ts, src, data, .. } => {
                if data.applied {
                    self.proposed_fix = None;
                }
                self.add_log(&ts, &src, format!(
                    "Fix {}: {}",
                    data.bug_id,
                    if data.applied { "applied" } else { "rejected" }
                ));
            }

            GlassboxEvent::BreakpointAdded { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!(
                    "Breakpoint added: {}:{}",
                    data.file, data.line
                ));
            }

            GlassboxEvent::WatchAdded { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!("Watch added: {}", data.expression));
            }

            GlassboxEvent::AppStarted { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!(
                    "App started: {} (pid {})",
                    data.main_class, data.pid
                ));
            }

            GlassboxEvent::AppStdout { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!("[stdout] {}", data.text));
            }

            GlassboxEvent::AppStderr { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!("[stderr] {}", data.text));
            }

            GlassboxEvent::Error { ts, src, data, .. } => {
                self.add_log(&ts, &src, format!("ERROR [{}]: {}", data.code, data.message));
            }
        }
    }
}

/// Extract HH:MM:SS from an ISO 8601 timestamp.
fn extract_time(ts: &str) -> String {
    // "2026-02-19T14:32:01.000Z" -> "14:32:01"
    if let Some(t_pos) = ts.find('T') {
        let after_t = &ts[t_pos + 1..];
        if let Some(dot_pos) = after_t.find('.') {
            return after_t[..dot_pos].to_string();
        }
        if let Some(z_pos) = after_t.find('Z') {
            return after_t[..z_pos].to_string();
        }
        return after_t[..8.min(after_t.len())].to_string();
    }
    ts.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::parser::parse_event;

    fn fixture_lines() -> Vec<String> {
        std::fs::read_to_string("tests/fixtures/npe-session.jsonl")
            .unwrap()
            .lines()
            .map(String::from)
            .collect()
    }

    #[test]
    fn initial_state() {
        let app = App::new();
        assert_eq!(app.phase, SessionPhase::Starting);
        assert_eq!(app.control_mode, ControlMode::Autonomous);
        assert_eq!(app.tokens_used, 0);
    }

    #[test]
    fn session_started_sets_waiting() {
        let mut app = App::new();
        let lines = fixture_lines();
        let ev = parse_event(&lines[0]).unwrap();
        app.apply_event(ev);
        assert_eq!(app.phase, SessionPhase::Waiting);
        assert_eq!(app.main_class, "com.example.PedidoService");
    }

    #[test]
    fn agent_action_increments_tokens() {
        let mut app = App::new();
        let lines = fixture_lines();
        // Apply session_started first
        app.apply_event(parse_event(&lines[0]).unwrap());
        // Apply agent_action (debug/catch, 15 tokens)
        app.apply_event(parse_event(&lines[1]).unwrap());
        assert_eq!(app.tokens_used, 15);
        assert_eq!(app.tool_calls, 1);
    }

    #[test]
    fn exception_caught_sets_phase() {
        let mut app = App::new();
        let lines = fixture_lines();
        for line in &lines[..5] {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.phase, SessionPhase::Exception);
        assert!(app.current_location.is_some());
    }

    #[test]
    fn agent_action_after_exception_sets_investigating() {
        let mut app = App::new();
        let lines = fixture_lines();
        for line in &lines[..7] {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.phase, SessionPhase::Investigating);
    }

    #[test]
    fn diagnosis_sets_phase_and_increments_bugs() {
        let mut app = App::new();
        let lines = fixture_lines();
        for line in &lines[..11] {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.phase, SessionPhase::Diagnosis);
        assert_eq!(app.bugs_found, 1);
        assert!(app.diagnosis.is_some());
    }

    #[test]
    fn fix_proposed_sets_phase() {
        let mut app = App::new();
        let lines = fixture_lines();
        for line in &lines[..13] {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.phase, SessionPhase::Fix);
        assert!(app.proposed_fix.is_some());
    }

    #[test]
    fn session_ended_sets_complete() {
        let mut app = App::new();
        let lines = fixture_lines();
        for line in &lines {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.phase, SessionPhase::Complete);
        assert!(app.show_summary);
    }

    #[test]
    fn full_session_event_log_count() {
        let mut app = App::new();
        let lines = fixture_lines();
        for line in &lines {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.event_log.len(), 14);
    }

    #[test]
    fn full_session_token_count() {
        let mut app = App::new();
        let lines = fixture_lines();
        for line in &lines {
            app.apply_event(parse_event(line).unwrap());
        }
        // 15 + 10 + 20 + 25 + 20 + 22 = 112 (6 agent_action events)
        assert_eq!(app.tokens_used, 112);
        assert_eq!(app.tool_calls, 6);
    }

    #[test]
    fn extract_time_works() {
        assert_eq!(extract_time("2026-02-19T14:32:01.000Z"), "14:32:01");
        assert_eq!(extract_time("2026-02-19T14:32:01Z"), "14:32:01");
    }

    #[test]
    fn can_user_act_by_mode() {
        let mut app = App::new();
        assert!(!app.can_user_act()); // Autonomous
        app.control_mode = ControlMode::Manual;
        assert!(app.can_user_act());
        app.control_mode = ControlMode::Collaborative;
        assert!(app.can_user_act());
    }

    #[test]
    fn cycle_panel() {
        let mut app = App::new();
        assert_eq!(app.active_panel, PanelId::Source);
        app.cycle_panel();
        assert_eq!(app.active_panel, PanelId::Variables);
        app.cycle_panel();
        assert_eq!(app.active_panel, PanelId::Agent);
    }

    #[test]
    fn tick_and_dot_visible() {
        let mut app = App::new();
        assert!(app.dot_visible()); // tick_count=0, (0/5)%2 == 0 => true
        for _ in 0..5 {
            app.tick();
        }
        assert!(!app.dot_visible()); // tick_count=5, (5/5)%2 == 1 => false
        for _ in 0..5 {
            app.tick();
        }
        assert!(app.dot_visible()); // tick_count=10, (10/5)%2 == 0 => true
    }

    #[test]
    fn parse_error_added_to_log() {
        let mut app = App::new();
        app.add_parse_error("bad json".to_string());
        assert_eq!(app.event_log.len(), 1);
        assert_eq!(app.event_log[0].text, "bad json");
        assert_eq!(app.event_log[0].ts, "??:??:??");
    }

    // ── Fixture-based integration tests ──

    fn replay_fixture(filename: &str) -> App {
        let lines = std::fs::read_to_string(format!("tests/fixtures/{}", filename))
            .unwrap();
        let mut app = App::new();
        for line in lines.lines() {
            if let Ok(ev) = parse_event(line) {
                app.apply_event(ev);
            }
        }
        app
    }

    #[test]
    fn manual_takeover_control_mode_transitions() {
        let content = std::fs::read_to_string("tests/fixtures/manual-takeover.jsonl").unwrap();
        let mut app = App::new();
        let lines: Vec<&str> = content.lines().collect();

        // Apply first 4 events: session_started, agent_action, exception, control_change(->user)
        for line in &lines[..4] {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.control_mode, ControlMode::Manual);

        // Apply through control_change(->ai) at line 7
        for line in &lines[4..8] {
            app.apply_event(parse_event(line).unwrap());
        }
        assert_eq!(app.control_mode, ControlMode::Autonomous);

        // Apply rest
        let app = replay_fixture("manual-takeover.jsonl");
        assert_eq!(app.phase, SessionPhase::Complete);
        assert_eq!(app.bugs_found, 1);
    }

    #[test]
    fn multi_bug_counts_both_bugs() {
        let app = replay_fixture("multi-bug.jsonl");
        assert_eq!(app.phase, SessionPhase::Complete);
        assert_eq!(app.bugs_found, 2);
        assert_eq!(app.tool_calls, 4);
        // fix_applied should clear proposed_fix
        assert!(app.proposed_fix.is_none());
    }

    #[test]
    fn error_recovery_handles_errors_gracefully() {
        let app = replay_fixture("error-recovery.jsonl");
        assert_eq!(app.phase, SessionPhase::Complete);
        assert_eq!(app.main_class, "com.example.BatchProcessor");
        // error event should be in event log
        let has_error = app.event_log.iter().any(|e| e.text.contains("TIMEOUT"));
        assert!(has_error, "error event should appear in event log");
        // Variables should have the null connection
        assert_eq!(app.variables.len(), 1);
        assert!(app.variables[0].is_null);
    }

    #[test]
    fn scroll_down_disables_auto_scroll_for_event_log() {
        let mut app = App::new();
        assert!(app.auto_scroll);
        app.active_panel = PanelId::EventLog;
        app.scroll_down();
        assert!(!app.auto_scroll);
    }

    #[test]
    fn scroll_on_source_keeps_auto_scroll() {
        let mut app = App::new();
        assert!(app.auto_scroll);
        app.active_panel = PanelId::Source;
        app.scroll_down();
        assert!(app.auto_scroll); // only event log disables auto_scroll
    }

    // ── Fase 11: Source result, cost, expand/collapse ──

    #[test]
    fn agent_action_debug_source_stores_result() {
        let mut app = App::new();
        let json = r#"{"type":"agent_action","ts":"2026-02-19T14:32:01.000Z","seq":1,"sessionId":"s1","src":"ai","data":{"tool":"debug/source","request":{},"result":{"file":"App.java","startLine":40,"endLine":50,"currentLine":45,"lines":[{"n":45,"text":"    return null;","isCurrent":true,"hasBreakpoint":false}]},"tokensUsed":30,"durationMs":50.0}}"#;
        let ev = parse_event(json).unwrap();
        app.apply_event(ev);
        assert!(app.source_result.is_some());
        let sr = app.source_result.as_ref().unwrap();
        assert_eq!(sr.file, "App.java");
        assert_eq!(sr.current_line, 45);
        assert_eq!(sr.lines.len(), 1);
        assert_eq!(sr.lines[0].text, "    return null;");
    }

    #[test]
    fn session_ended_stores_cost() {
        let mut app = App::new();
        let json = r#"{"type":"session_ended","ts":"2026-02-19T14:32:10.000Z","seq":2,"sessionId":"s1","src":"system","data":{"durationMs":5000.0,"toolCalls":10,"tokensUsed":200,"estimatedCostUsd":0.006,"bugsFound":1}}"#;
        let ev = parse_event(json).unwrap();
        app.apply_event(ev);
        assert!((app.estimated_cost_usd - 0.006).abs() < 0.0001);
        assert_eq!(app.phase, SessionPhase::Complete);
    }

    #[test]
    fn toggle_var_expand() {
        let mut app = App::new();
        app.variables = vec![
            Variable {
                name: "obj".to_string(),
                type_name: "Object".to_string(),
                value: "{field: 1}".to_string(),
                is_null: false,
                expandable: true,
                alert: None,
            },
        ];
        app.selected_var_index = 0;
        assert!(!app.expanded_vars.contains("obj"));
        app.toggle_var_expand();
        assert!(app.expanded_vars.contains("obj"));
        app.toggle_var_expand();
        assert!(!app.expanded_vars.contains("obj"));
    }

    #[test]
    fn toggle_var_expand_noop_on_empty() {
        let mut app = App::new();
        app.toggle_var_expand(); // should not panic
        assert!(app.expanded_vars.is_empty());
    }
}
