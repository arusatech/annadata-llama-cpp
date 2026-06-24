/// Token streaming support for Wasm inference
/// Handles token-by-token generation callbacks

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenEvent {
    pub index: u32,
    pub token: String,
    pub bytes: Option<Vec<u8>>,
}

/// Stream context for managing token callbacks
pub struct StreamContext {
    pub buffer: String,
    pub token_count: u32,
}

impl StreamContext {
    pub fn new() -> Self {
        StreamContext {
            buffer: String::new(),
            token_count: 0,
        }
    }

    pub fn push_token(&mut self, token: &str) -> TokenEvent {
        self.buffer.push_str(token);
        let event = TokenEvent {
            index: self.token_count,
            token: token.to_string(),
            bytes: Some(token.as_bytes().to_vec()),
        };
        self.token_count += 1;
        event
    }

    pub fn finish(self) -> String {
        self.buffer
    }
}
