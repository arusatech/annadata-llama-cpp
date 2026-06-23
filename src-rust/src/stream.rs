pub fn split_for_streaming(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut chunk = String::new();
    for ch in text.chars() {
        chunk.push(ch);
        if ch == ' ' || ch == '\n' || chunk.len() >= 16 {
            out.push(chunk.clone());
            chunk.clear();
        }
    }
    if !chunk.is_empty() {
        out.push(chunk);
    }
    out
}

