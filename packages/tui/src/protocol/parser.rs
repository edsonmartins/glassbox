use super::types::GlassboxEvent;

/// Parse a single JSONL line into a GlassboxEvent.
pub fn parse_event(line: &str) -> Result<GlassboxEvent, serde_json::Error> {
    serde_json::from_str(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(type_name: &str, data: &str) -> String {
        format!(
            r#"{{"type":"{}","ts":"2026-02-19T14:32:01.000Z","seq":0,"sessionId":"sess-1","src":"debugger","data":{}}}"#,
            type_name, data
        )
    }

    fn make_ai_event(type_name: &str, data: &str) -> String {
        format!(
            r#"{{"type":"{}","ts":"2026-02-19T14:32:01.000Z","seq":0,"sessionId":"sess-1","src":"ai","data":{}}}"#,
            type_name, data
        )
    }

    fn make_user_event(type_name: &str, data: &str) -> String {
        format!(
            r#"{{"type":"{}","ts":"2026-02-19T14:32:01.000Z","seq":0,"sessionId":"sess-1","src":"user","data":{}}}"#,
            type_name, data
        )
    }

    fn make_system_event(type_name: &str, data: &str) -> String {
        format!(
            r#"{{"type":"{}","ts":"2026-02-19T14:32:01.000Z","seq":0,"sessionId":"sess-1","src":"system","data":{}}}"#,
            type_name, data
        )
    }

    #[test]
    fn parse_session_started() {
        let json = make_event("session_started", r#"{"pid":1234,"jdkVersion":"17.0.1","mainClass":"com.example.App","jdwpPort":5005}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::SessionStarted { .. }));
        assert_eq!(ev.type_name(), "session_started");
    }

    #[test]
    fn parse_session_ended() {
        let json = make_system_event("session_ended", r#"{"durationMs":5000,"toolCalls":10,"tokensUsed":200,"estimatedCostUsd":0.006,"bugsFound":1}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::SessionEnded { .. }));
    }

    #[test]
    fn parse_breakpoint_hit() {
        let json = make_event("breakpoint_hit", r#"{"breakpointId":"bp-1","location":{"file":"App.java","line":47,"class":"com.example.App","method":"main"},"thread":"main"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::BreakpointHit { .. }));
    }

    #[test]
    fn parse_exception_caught() {
        let json = make_event("exception_caught", r#"{"exceptionType":"java.lang.NullPointerException","message":"Cannot invoke method on null","location":{"file":"PedidoService.java","line":47,"class":"com.example.PedidoService","method":"criarPedido"},"thread":"main","isCaught":true}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::ExceptionCaught { .. }));
    }

    #[test]
    fn parse_step_completed() {
        let json = make_event("step_completed", r#"{"stepType":"over","location":{"file":"App.java","line":48,"class":"com.example.App","method":"main"},"thread":"main"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::StepCompleted { .. }));
    }

    #[test]
    fn parse_thread_started() {
        let json = make_event("thread_started", r#"{"thread":"http-nio-8080-exec-1"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::ThreadStarted { .. }));
    }

    #[test]
    fn parse_thread_died() {
        let json = make_event("thread_died", r#"{"thread":"http-nio-8080-exec-1"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::ThreadDied { .. }));
    }

    #[test]
    fn parse_agent_action() {
        let json = make_ai_event("agent_action", r#"{"tool":"debug/stacktrace","request":{"thread":"main"},"result":{"frames":[]},"tokensUsed":50,"durationMs":120.5}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::AgentAction { .. }));
    }

    #[test]
    fn parse_agent_thinking() {
        let json = make_ai_event("agent_thinking", r#"{"thought":"Investigating NPE at line 47"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::AgentThinking { .. }));
    }

    #[test]
    fn parse_diagnosis() {
        let json = make_ai_event("diagnosis", r#"{"bugId":"NPE-001","severity":"HIGH","title":"NPE in PedidoService","rootCause":"cliente is null","affectedLocation":{"file":"PedidoService.java","line":47,"class":"com.example.PedidoService","method":"criarPedido"},"totalTokens":134,"elapsedMs":3200.0}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::Diagnosis { .. }));
    }

    #[test]
    fn parse_fix_proposed() {
        let json = make_ai_event("fix_proposed", r#"{"bugId":"NPE-001","fixType":"code_change","file":"PedidoService.java","diff":"- .orElse(null);\n+ .orElseThrow(() -> new EntityNotFoundException());","explanation":"Replace orElse(null) with orElseThrow","confidence":0.95}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::FixProposed { .. }));
    }

    #[test]
    fn parse_control_change() {
        let json = make_user_event("control_change", r#"{"from":"ai","to":"user","reason":"manual_takeover"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::ControlChange { .. }));
    }

    #[test]
    fn parse_manual_step() {
        let json = make_user_event("manual_step", r#"{"action":"step_over","location":{"file":"App.java","line":48,"class":"com.example.App","method":"main"},"thread":"main"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::ManualStep { .. }));
    }

    #[test]
    fn parse_manual_eval() {
        let json = make_user_event("manual_eval", r#"{"expression":"dto.getClienteId()","result":"999"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::ManualEval { .. }));
    }

    #[test]
    fn parse_fix_applied() {
        let json = make_user_event("fix_applied", r#"{"bugId":"NPE-001","applied":true}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::FixApplied { .. }));
    }

    #[test]
    fn parse_app_stdout() {
        let json = make_system_event("app_stdout", r#"{"text":"Server started on port 8080","truncated":false}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::AppStdout { .. }));
    }

    #[test]
    fn parse_app_stderr() {
        let json = make_system_event("app_stderr", r#"{"text":"WARNING: something","truncated":false}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::AppStderr { .. }));
    }

    #[test]
    fn parse_error() {
        let json = make_system_event("error", r#"{"code":"JDB_TIMEOUT","message":"Command timed out"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::Error { .. }));
    }

    #[test]
    fn parse_breakpoint_added() {
        let json = make_ai_event("breakpoint_added", r#"{"breakpointId":"bp-1","file":"App.java","line":42}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::BreakpointAdded { .. }));
        assert_eq!(ev.type_name(), "breakpoint_added");
        assert_eq!(ev.display_text(), "Breakpoint added: App.java:42");
    }

    #[test]
    fn parse_watch_added() {
        let json = make_user_event("watch_added", r#"{"expression":"dto.getClienteId()"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::WatchAdded { .. }));
        assert_eq!(ev.type_name(), "watch_added");
        assert_eq!(ev.display_text(), "Watch added: dto.getClienteId()");
    }

    #[test]
    fn parse_app_started() {
        let json = make_system_event("app_started", r#"{"pid":5678,"mainClass":"com.example.App"}"#);
        let ev = parse_event(&json).unwrap();
        assert!(matches!(ev, GlassboxEvent::AppStarted { .. }));
        assert_eq!(ev.type_name(), "app_started");
        assert_eq!(ev.display_text(), "App started: com.example.App (pid 5678)");
    }

    #[test]
    fn parse_malformed_json_returns_error() {
        let result = parse_event("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn parse_unknown_type_returns_error() {
        let json = make_event("unknown_event_type", r#"{"foo":"bar"}"#);
        let result = parse_event(&json);
        assert!(result.is_err());
    }

    #[test]
    fn display_text_works() {
        let json = make_ai_event("agent_action", r#"{"tool":"debug/locals","request":{},"result":{},"tokensUsed":25,"durationMs":50.0}"#);
        let ev = parse_event(&json).unwrap();
        assert_eq!(ev.display_text(), "debug/locals (25tok)");
    }
}
