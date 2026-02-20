use std::fs;

// Since glassbox-tui is a binary crate, we validate fixtures here as integration tests.
// The parser itself is tested via inline #[cfg(test)] in src/protocol/parser.rs.

#[test]
fn fixture_npe_session_parses_all_events() {
    let content = fs::read_to_string("tests/fixtures/npe-session.jsonl")
        .expect("fixture file should exist");

    let lines: Vec<&str> = content.lines().collect();
    assert_eq!(lines.len(), 14, "fixture should have 14 events");

    // Verify each line is valid JSON with required fields
    for (i, line) in lines.iter().enumerate() {
        let parsed: serde_json::Value = serde_json::from_str(line)
            .unwrap_or_else(|e| panic!("line {} should be valid JSON: {}", i, e));

        assert!(parsed.get("type").is_some(), "line {} should have a 'type' field", i);
        assert!(parsed.get("ts").is_some(), "line {} should have a 'ts' field", i);
        assert!(parsed.get("seq").is_some(), "line {} should have a 'seq' field", i);
        assert!(parsed.get("sessionId").is_some(), "line {} should have a 'sessionId' field", i);
    }

    // Verify expected event type sequence
    let expected_types = vec![
        "session_started", "agent_action", "agent_action", "app_stdout",
        "exception_caught", "agent_thinking", "agent_action", "agent_action",
        "agent_action", "agent_action", "diagnosis", "agent_thinking",
        "fix_proposed", "session_ended",
    ];

    for (i, (line, expected)) in lines.iter().zip(expected_types.iter()).enumerate() {
        let parsed: serde_json::Value = serde_json::from_str(line).unwrap();
        let actual = parsed["type"].as_str().unwrap();
        assert_eq!(actual, *expected, "line {} should be type '{}', got '{}'", i, expected, actual);
    }
}

#[test]
fn fixture_manual_takeover_has_control_changes() {
    let content = fs::read_to_string("tests/fixtures/manual-takeover.jsonl")
        .expect("fixture file should exist");

    let lines: Vec<&str> = content.lines().collect();
    assert_eq!(lines.len(), 11, "manual-takeover should have 11 events");

    // Verify expected event type sequence
    let expected_types = vec![
        "session_started", "agent_action", "exception_caught",
        "control_change", "manual_step", "manual_step",
        "manual_eval", "control_change", "agent_thinking",
        "diagnosis", "session_ended",
    ];

    for (i, (line, expected)) in lines.iter().zip(expected_types.iter()).enumerate() {
        let parsed: serde_json::Value = serde_json::from_str(line).unwrap();
        let actual = parsed["type"].as_str().unwrap();
        assert_eq!(actual, *expected, "line {} should be '{}', got '{}'", i, expected, actual);
    }

    // Verify control_change events have from/to fields
    let control_events: Vec<serde_json::Value> = lines.iter()
        .filter_map(|l| {
            let v: serde_json::Value = serde_json::from_str(l).ok()?;
            if v["type"] == "control_change" { Some(v) } else { None }
        })
        .collect();

    assert_eq!(control_events.len(), 2, "should have 2 control_change events");
    assert_eq!(control_events[0]["data"]["to"], "user");
    assert_eq!(control_events[1]["data"]["to"], "ai");
}

#[test]
fn fixture_multi_bug_finds_two_bugs() {
    let content = fs::read_to_string("tests/fixtures/multi-bug.jsonl")
        .expect("fixture file should exist");

    let lines: Vec<&str> = content.lines().collect();
    assert_eq!(lines.len(), 12, "multi-bug should have 12 events");

    // Count diagnosis events (should be 2 bugs)
    let diagnosis_count = lines.iter()
        .filter(|l| {
            serde_json::from_str::<serde_json::Value>(l)
                .map(|v| v["type"] == "diagnosis")
                .unwrap_or(false)
        })
        .count();
    assert_eq!(diagnosis_count, 2, "should find 2 bugs");

    // Verify fix_applied event
    let fix_applied: Vec<serde_json::Value> = lines.iter()
        .filter_map(|l| {
            let v: serde_json::Value = serde_json::from_str(l).ok()?;
            if v["type"] == "fix_applied" { Some(v) } else { None }
        })
        .collect();
    assert_eq!(fix_applied.len(), 1);
    assert_eq!(fix_applied[0]["data"]["applied"], true);

    // Verify session_ended reports 2 bugs
    let ended: serde_json::Value = serde_json::from_str(lines.last().unwrap()).unwrap();
    assert_eq!(ended["data"]["bugsFound"], 2);
}

#[test]
fn fixture_error_recovery_has_malformed_lines() {
    let content = fs::read_to_string("tests/fixtures/error-recovery.jsonl")
        .expect("fixture file should exist");

    let lines: Vec<&str> = content.lines().collect();
    assert_eq!(lines.len(), 10, "error-recovery should have 10 lines (including malformed)");

    // Count lines that are valid JSON
    let valid_json_count = lines.iter()
        .filter(|l| serde_json::from_str::<serde_json::Value>(l).is_ok())
        .count();

    // 10 lines total, 2 are malformed (plain text + unclosed brace)
    assert_eq!(valid_json_count, 8, "should have 8 valid JSON lines");

    // Count lines that are valid glassbox events (have type, ts, seq, sessionId)
    let valid_event_count = lines.iter()
        .filter(|l| {
            serde_json::from_str::<serde_json::Value>(l)
                .map(|v| {
                    v.get("type").is_some()
                        && v.get("ts").is_some()
                        && v.get("seq").is_some()
                        && v.get("sessionId").is_some()
                        // Exclude unknown_future_event which won't parse as GlassboxEvent
                        && v["type"] != "unknown_future_event"
                })
                .unwrap_or(false)
        })
        .count();
    assert_eq!(valid_event_count, 7, "should have 7 known event types");

    // Verify error event has code and message
    let error_event: serde_json::Value = lines.iter()
        .find_map(|l| {
            let v: serde_json::Value = serde_json::from_str(l).ok()?;
            if v["type"] == "error" { Some(v) } else { None }
        })
        .expect("should have an error event");
    assert_eq!(error_event["data"]["code"], "TIMEOUT");
}
