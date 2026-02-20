use ratatui::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LayoutMode {
    Full,    // >= 120 cols: all panels
    Compact, // 80-119 cols: Source + Agent, Tab for Variables
    Minimal, // < 80 cols: Event Log + Status only
}

pub fn compute_layout_mode(width: u16) -> LayoutMode {
    if width >= 120 {
        LayoutMode::Full
    } else if width >= 80 {
        LayoutMode::Compact
    } else {
        LayoutMode::Minimal
    }
}

/// Top-level vertical split: title, main, side_info, event_log, status.
pub fn main_layout(area: Rect, mode: LayoutMode) -> Vec<Rect> {
    match mode {
        LayoutMode::Full => Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),  // title bar
                Constraint::Min(8),    // main area (source + vars + agent)
                Constraint::Length(5), // side info (call stack + threads)
                Constraint::Length(8), // event log
                Constraint::Length(1), // status bar
            ])
            .split(area)
            .to_vec(),
        LayoutMode::Compact => Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),  // title bar
                Constraint::Min(8),    // main area (source + agent)
                Constraint::Length(8), // event log
                Constraint::Length(1), // status bar
            ])
            .split(area)
            .to_vec(),
        LayoutMode::Minimal => Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),  // title bar
                Constraint::Min(4),    // event log
                Constraint::Length(1), // status bar
            ])
            .split(area)
            .to_vec(),
    }
}

/// Horizontal split for the main area: Source (55%) | Right side (45%).
pub fn main_horizontal(area: Rect) -> (Rect, Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(55),
            Constraint::Percentage(45),
        ])
        .split(area);
    (chunks[0], chunks[1])
}

/// Right side vertical split: Variables (50%) | Agent (50%).
pub fn right_vertical(area: Rect) -> (Rect, Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(50),
            Constraint::Percentage(50),
        ])
        .split(area);
    (chunks[0], chunks[1])
}

/// Side info horizontal split: Call Stack (50%) | Threads (50%).
pub fn side_info_split(area: Rect) -> (Rect, Rect) {
    let chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(50),
            Constraint::Percentage(50),
        ])
        .split(area);
    (chunks[0], chunks[1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_mode_boundaries() {
        assert_eq!(compute_layout_mode(120), LayoutMode::Full);
        assert_eq!(compute_layout_mode(200), LayoutMode::Full);
        assert_eq!(compute_layout_mode(119), LayoutMode::Compact);
        assert_eq!(compute_layout_mode(80), LayoutMode::Compact);
        assert_eq!(compute_layout_mode(79), LayoutMode::Minimal);
        assert_eq!(compute_layout_mode(40), LayoutMode::Minimal);
    }

    #[test]
    fn main_layout_full_has_5_chunks() {
        let area = Rect::new(0, 0, 140, 40);
        let chunks = main_layout(area, LayoutMode::Full);
        assert_eq!(chunks.len(), 5);
    }

    #[test]
    fn main_layout_compact_has_4_chunks() {
        let area = Rect::new(0, 0, 100, 30);
        let chunks = main_layout(area, LayoutMode::Compact);
        assert_eq!(chunks.len(), 4);
    }

    #[test]
    fn main_layout_minimal_has_3_chunks() {
        let area = Rect::new(0, 0, 60, 20);
        let chunks = main_layout(area, LayoutMode::Minimal);
        assert_eq!(chunks.len(), 3);
    }
}
