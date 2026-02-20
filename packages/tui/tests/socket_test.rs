use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::sync::mpsc;
use std::thread;

/// Test that SocketConnection can connect to a mock server and exchange data.
///
/// We can't import from a binary crate, so we test the socket protocol
/// at the JSONL level: mock server sends events, client reads them.
#[test]
fn mock_server_sends_events_and_client_reads() {
    let socket_path = "/tmp/glassbox-test-mock.sock";

    // Clean up stale socket
    let _ = std::fs::remove_file(socket_path);

    // Create mock server
    let listener = UnixListener::bind(socket_path).expect("bind");

    let (tx, rx) = mpsc::channel::<String>();

    // Server thread: accept connection, send 2 JSONL events
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");

        let event1 = r#"{"type":"agent_thinking","ts":"2026-01-01T00:00:00Z","seq":0,"sessionId":"test","src":"ai","data":{"thought":"hello"}}"#;
        let event2 = r#"{"type":"agent_thinking","ts":"2026-01-01T00:00:01Z","seq":1,"sessionId":"test","src":"ai","data":{"thought":"world"}}"#;

        stream.write_all(event1.as_bytes()).unwrap();
        stream.write_all(b"\n").unwrap();
        stream.write_all(event2.as_bytes()).unwrap();
        stream.write_all(b"\n").unwrap();
        stream.flush().unwrap();

        // Read command from client
        let reader = BufReader::new(&stream);
        for line in reader.lines() {
            match line {
                Ok(l) if !l.is_empty() => {
                    let _ = tx.send(l);
                    break;
                }
                _ => break,
            }
        }
    });

    // Client side: connect and read events
    let client_stream = std::os::unix::net::UnixStream::connect(socket_path).expect("connect");
    let mut writer = client_stream.try_clone().expect("clone");
    let reader = BufReader::new(client_stream);

    let mut events = Vec::new();
    for line in reader.lines() {
        match line {
            Ok(l) if l.is_empty() => continue,
            Ok(l) => {
                let parsed: serde_json::Value = serde_json::from_str(&l).expect("parse JSON");
                events.push(parsed);
                if events.len() >= 2 {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["type"], "agent_thinking");
    assert_eq!(events[0]["data"]["thought"], "hello");
    assert_eq!(events[1]["data"]["thought"], "world");

    // Send a command back
    let cmd = r#"{"type":"command","action":"continue","args":{}}"#;
    writer.write_all(cmd.as_bytes()).unwrap();
    writer.write_all(b"\n").unwrap();
    writer.flush().unwrap();

    // Verify server received it
    let received = rx.recv_timeout(std::time::Duration::from_secs(2)).expect("recv");
    let parsed: serde_json::Value = serde_json::from_str(&received).expect("parse cmd");
    assert_eq!(parsed["type"], "command");
    assert_eq!(parsed["action"], "continue");

    server.join().unwrap();

    // Cleanup
    let _ = std::fs::remove_file(socket_path);
}
