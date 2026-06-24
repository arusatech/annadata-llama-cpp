/// Model types and request/response structures for Wasm inference

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub prompt: Option<String>,
    pub messages: Option<Vec<ChatMessage>>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    pub top_p: Option<f32>,
    pub top_k: Option<u32>,
    pub stream: Option<bool>,
    #[serde(default)]
    pub stop: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateResponse {
    pub text: String,
    pub tokens_predicted: u32,
    pub tokens_evaluated: u32,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EmbedInput {
    Single(String),
    Multiple(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedRequest {
    pub input: EmbedInput,
    #[serde(default)]
    pub normalize: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedResponse {
    pub vectors: Vec<Vec<f32>>,
}

/// Model initialization options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInitOptions {
    pub model_path: Option<String>,
    pub n_ctx: Option<u32>,
    pub n_threads: Option<u32>,
    pub n_batch: Option<u32>,
    pub n_gpu_layers: Option<u32>,
    pub embedding: Option<bool>,
    pub use_mmap: Option<bool>,
    pub use_mlock: Option<bool>,
}

/// Internal context parameters for C/C++ bridge
#[derive(Debug, Serialize)]
pub struct ContextParams {
    pub model: String,
    pub n_ctx: u32,
    pub n_threads: u32,
    pub n_batch: u32,
    pub n_gpu_layers: u32,
    pub embedding: bool,
    pub use_mmap: bool,
    pub use_mlock: bool,
}

impl Default for ContextParams {
    fn default() -> Self {
        Self {
            model: String::new(),
            n_ctx: 2048,
            n_threads: 4,
            n_batch: 512,
            n_gpu_layers: 0,
            embedding: false,
            use_mmap: true,
            use_mlock: false,
        }
    }
}

/// Completion parameters for C/C++ bridge
#[derive(Debug, Serialize)]
pub struct CompletionParams {
    pub prompt: String,
    pub n_predict: u32,
    pub temperature: f32,
    pub top_p: f32,
    pub top_k: u32,
    pub stop: Vec<String>,
}

impl Default for CompletionParams {
    fn default() -> Self {
        Self {
            prompt: String::new(),
            n_predict: 128,
            temperature: 0.7,
            top_p: 0.95,
            top_k: 40,
            stop: vec![],
        }
    }
}
