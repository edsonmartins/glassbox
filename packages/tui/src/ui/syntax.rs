use ratatui::prelude::*;

use crate::theme;

/// Java keywords for syntax highlighting.
const JAVA_KEYWORDS: &[&str] = &[
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
    "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "final", "finally", "float", "for", "goto", "if", "implements",
    "import", "instanceof", "int", "interface", "long", "native", "new",
    "package", "private", "protected", "public", "return", "short", "static",
    "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
    "transient", "try", "void", "volatile", "while",
    "true", "false", "null", "var",
];

/// Highlight a single line of Java source code into styled spans.
pub fn highlight_java<'a>(line: &'a str) -> Vec<Span<'a>> {
    let mut spans = Vec::new();
    let chars: Vec<char> = line.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // Line comment
        if i + 1 < len && chars[i] == '/' && chars[i + 1] == '/' {
            spans.push(Span::styled(
                &line[byte_offset(line, i)..],
                Style::default().fg(theme::TEXT_DIM),
            ));
            return spans;
        }

        // String literal
        if chars[i] == '"' {
            let start = i;
            i += 1;
            while i < len && chars[i] != '"' {
                if chars[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < len {
                i += 1; // closing quote
            }
            spans.push(Span::styled(
                &line[byte_offset(line, start)..byte_offset(line, i)],
                Style::default().fg(theme::GREEN),
            ));
            continue;
        }

        // Char literal
        if chars[i] == '\'' {
            let start = i;
            i += 1;
            while i < len && chars[i] != '\'' {
                if chars[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < len {
                i += 1;
            }
            spans.push(Span::styled(
                &line[byte_offset(line, start)..byte_offset(line, i)],
                Style::default().fg(theme::GREEN),
            ));
            continue;
        }

        // Number literal
        if chars[i].is_ascii_digit() && (i == 0 || !chars[i - 1].is_alphanumeric()) {
            let start = i;
            while i < len && (chars[i].is_ascii_digit() || chars[i] == '.' || chars[i] == 'x' || chars[i] == 'L' || chars[i] == 'f') {
                i += 1;
            }
            spans.push(Span::styled(
                &line[byte_offset(line, start)..byte_offset(line, i)],
                Style::default().fg(theme::ORANGE),
            ));
            continue;
        }

        // Identifier or keyword
        if chars[i].is_alphabetic() || chars[i] == '_' {
            let start = i;
            while i < len && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let word = &line[byte_offset(line, start)..byte_offset(line, i)];
            if JAVA_KEYWORDS.contains(&word) {
                spans.push(Span::styled(word, Style::default().fg(theme::PURPLE).bold()));
            } else if word.chars().next().map_or(false, |c| c.is_uppercase()) {
                // Type name (capitalized identifier)
                spans.push(Span::styled(word, Style::default().fg(theme::CYAN)));
            } else {
                spans.push(Span::styled(word, Style::default().fg(theme::TEXT)));
            }
            continue;
        }

        // Annotation
        if chars[i] == '@' {
            let start = i;
            i += 1;
            while i < len && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            spans.push(Span::styled(
                &line[byte_offset(line, start)..byte_offset(line, i)],
                Style::default().fg(theme::YELLOW),
            ));
            continue;
        }

        // Whitespace and other characters
        let start = i;
        i += 1;
        spans.push(Span::styled(
            &line[byte_offset(line, start)..byte_offset(line, i)],
            Style::default().fg(theme::TEXT),
        ));
    }

    spans
}

/// Convert a char index to a byte offset in the string.
fn byte_offset(s: &str, char_idx: usize) -> usize {
    s.char_indices()
        .nth(char_idx)
        .map(|(b, _)| b)
        .unwrap_or(s.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn highlight_empty_line() {
        let spans = highlight_java("");
        assert!(spans.is_empty());
    }

    #[test]
    fn highlight_keyword() {
        let spans = highlight_java("return null;");
        assert!(spans.len() >= 2);
        // "return" should be purple/bold keyword
        assert!(spans[0].content.contains("return"));
    }

    #[test]
    fn highlight_string_literal() {
        let spans = highlight_java("String s = \"hello\";");
        // Should have a green string span
        let has_string = spans.iter().any(|s| s.content.contains("hello"));
        assert!(has_string);
    }

    #[test]
    fn highlight_comment() {
        let spans = highlight_java("// this is a comment");
        assert_eq!(spans.len(), 1);
    }

    #[test]
    fn highlight_number() {
        let spans = highlight_java("int x = 42;");
        let has_number = spans.iter().any(|s| s.content.contains("42"));
        assert!(has_number);
    }

    #[test]
    fn highlight_annotation() {
        let spans = highlight_java("@Override");
        assert_eq!(spans.len(), 1);
        assert!(spans[0].content.contains("Override"));
    }
}
