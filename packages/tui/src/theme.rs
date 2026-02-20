use ratatui::style::Color;
use unicode_width::UnicodeWidthStr;

// Background colors
pub const BG: Color = Color::Rgb(13, 17, 23);
pub const BG_PANEL: Color = Color::Rgb(22, 27, 34);
pub const BG_ACTIVE: Color = Color::Rgb(28, 35, 51);

// Border colors
pub const BORDER: Color = Color::Rgb(48, 54, 61);
pub const BORDER_ACTIVE: Color = Color::Rgb(88, 166, 255);

// Text colors
pub const TEXT: Color = Color::Rgb(201, 209, 217);
pub const TEXT_DIM: Color = Color::Rgb(139, 148, 158);
pub const TEXT_BRIGHT: Color = Color::Rgb(240, 246, 252);

// Accent colors
pub const ACCENT: Color = Color::Rgb(88, 166, 255);
pub const GREEN: Color = Color::Rgb(63, 185, 80);
pub const RED: Color = Color::Rgb(248, 81, 73);
pub const ORANGE: Color = Color::Rgb(210, 153, 34);
pub const PURPLE: Color = Color::Rgb(188, 140, 255);
pub const CYAN: Color = Color::Rgb(57, 211, 83);
pub const YELLOW: Color = Color::Rgb(227, 179, 65);

// Diff colors
pub const DIFF_ADD: Color = Color::Rgb(13, 40, 24);
pub const DIFF_REMOVE: Color = Color::Rgb(61, 17, 20);

// Line highlight
pub const LINE_HIGHLIGHT: Color = Color::Rgb(28, 35, 51);

/// Truncate a string to fit within `max_width` display columns, appending "..." if truncated.
pub fn truncate(s: &str, max_width: usize) -> String {
    if s.width() <= max_width {
        return s.to_string();
    }
    if max_width <= 3 {
        return ".".repeat(max_width);
    }
    let target = max_width - 3;
    let mut width = 0;
    let mut end = 0;
    for (i, ch) in s.char_indices() {
        let cw = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(0);
        if width + cw > target {
            break;
        }
        width += cw;
        end = i + ch.len_utf8();
    }
    format!("{}...", &s[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_short_string_unchanged() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn truncate_long_string() {
        assert_eq!(truncate("hello world!", 8), "hello...");
    }

    #[test]
    fn truncate_exact_fit() {
        assert_eq!(truncate("hello", 5), "hello");
    }

    #[test]
    fn truncate_tiny_width() {
        assert_eq!(truncate("hello", 2), "..");
    }
}
