/// Rust FFI bindings to llama.cpp C/C++ functions
/// These are the foreign function declarations that link to the compiled llama.cpp library

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

/// Extern C declarations for llama.cpp context management
#[link(name = "llama_engine_embedded_c", kind = "static")]
#[link(name = "llama_engine_embedded_cpp", kind = "static")]
extern "C" {
    /// Initialize a new inference context from a GGUF model file
    /// Returns a context handle (pointer cast to i64) or 0 on failure
    pub fn llama_init_context(
        model_path: *const c_char,
        params_json: *const c_char,
    ) -> i64;

    /// Release a context and free its resources
    pub fn llama_release_context(context_id: i64) -> i32;

    /// Run text completion/generation
    /// Returns JSON string with completion result
    pub fn llama_completion(
        context_id: i64,
        params_json: *const c_char,
    ) -> *const c_char;

    /// Generate embeddings for input text
    /// Returns JSON string with embedding vector
    pub fn llama_embedding(
        context_id: i64,
        text: *const c_char,
        params_json: *const c_char,
    ) -> *const c_char;

    /// Tokenize text into tokens
    pub fn llama_tokenize(
        context_id: i64,
        text: *const c_char,
    ) -> *const c_char;

    /// Detokenize tokens back to text
    pub fn llama_detokenize(
        context_id: i64,
        tokens_json: *const c_char,
    ) -> *const c_char;
}

/// Safe wrapper for initialization
pub fn init_context(model_path: &str, params_json: &str) -> Result<i64, String> {
    let model_path_cstr = CString::new(model_path)
        .map_err(|e| format!("Invalid model path: {}", e))?;
    let params_cstr = CString::new(params_json)
        .map_err(|e| format!("Invalid params JSON: {}", e))?;

    unsafe {
        let context_id = llama_init_context(model_path_cstr.as_ptr(), params_cstr.as_ptr());
        if context_id <= 0 {
            return Err("Failed to initialize context - model may be invalid or corrupted".to_string());
        }
        Ok(context_id)
    }
}

/// Safe wrapper for context release
pub fn release_context(context_id: i64) {
    unsafe {
        let _ = llama_release_context(context_id);
    }
}

/// Safe wrapper for completion
pub fn completion(context_id: i64, params_json: &str) -> Result<String, String> {
    let params_cstr = CString::new(params_json)
        .map_err(|e| format!("Invalid params JSON: {}", e))?;

    unsafe {
        let result_ptr = llama_completion(context_id, params_cstr.as_ptr());
        if result_ptr.is_null() {
            return Err("Completion returned null".to_string());
        }

        let result_cstr = CStr::from_ptr(result_ptr);
        let result_str = result_cstr
            .to_str()
            .map_err(|e| format!("Invalid UTF-8 in completion result: {}", e))?
            .to_string();

        Ok(result_str)
    }
}

/// Safe wrapper for embedding
pub fn embedding(context_id: i64, text: &str, params_json: &str) -> Result<Vec<f32>, String> {
    let text_cstr = CString::new(text)
        .map_err(|e| format!("Invalid text: {}", e))?;
    let params_cstr = CString::new(params_json)
        .map_err(|e| format!("Invalid params JSON: {}", e))?;

    unsafe {
        let result_ptr = llama_embedding(context_id, text_cstr.as_ptr(), params_cstr.as_ptr());
        if result_ptr.is_null() {
            return Err("Embedding returned null".to_string());
        }

        let result_cstr = CStr::from_ptr(result_ptr);
        let result_str = result_cstr
            .to_str()
            .map_err(|e| format!("Invalid UTF-8 in embedding result: {}", e))?;

        // Parse JSON response: {"embedding": [f32, f32, ...]}
        let json_result: serde_json::Value = serde_json::from_str(result_str)
            .map_err(|e| format!("Invalid JSON response: {}", e))?;

        let embedding_arr = json_result
            .get("embedding")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Missing 'embedding' array in response".to_string())?;

        let vector: Vec<f32> = embedding_arr
            .iter()
            .map(|v| v.as_f64().unwrap_or(0.0) as f32)
            .collect();

        Ok(vector)
    }
}

/// Safe wrapper for tokenization
pub fn tokenize(context_id: i64, text: &str) -> Result<Vec<i32>, String> {
    let text_cstr = CString::new(text)
        .map_err(|e| format!("Invalid text: {}", e))?;

    unsafe {
        let result_ptr = llama_tokenize(context_id, text_cstr.as_ptr());
        if result_ptr.is_null() {
            return Err("Tokenize returned null".to_string());
        }

        let result_cstr = CStr::from_ptr(result_ptr);
        let result_str = result_cstr
            .to_str()
            .map_err(|e| format!("Invalid UTF-8 in tokenize result: {}", e))?;

        // Parse JSON response: {"tokens": [i32, i32, ...]}
        let json_result: serde_json::Value = serde_json::from_str(result_str)
            .map_err(|e| format!("Invalid JSON response: {}", e))?;

        let tokens_arr = json_result
            .get("tokens")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Missing 'tokens' array in response".to_string())?;

        let tokens: Vec<i32> = tokens_arr
            .iter()
            .map(|v| v.as_i64().unwrap_or(0) as i32)
            .collect();

        Ok(tokens)
    }
}

/// Safe wrapper for detokenization
pub fn detokenize(context_id: i64, tokens: &[i32]) -> Result<String, String> {
    let tokens_json = serde_json::to_string(&tokens)
        .map_err(|e| format!("Failed to serialize tokens: {}", e))?;

    let tokens_cstr = CString::new(tokens_json)
        .map_err(|e| format!("Invalid tokens JSON: {}", e))?;

    unsafe {
        let result_ptr = llama_detokenize(context_id, tokens_cstr.as_ptr());
        if result_ptr.is_null() {
            return Err("Detokenize returned null".to_string());
        }

        let result_cstr = CStr::from_ptr(result_ptr);
        let result_str = result_cstr
            .to_str()
            .map_err(|e| format!("Invalid UTF-8 in detokenize result: {}", e))?
            .to_string();

        Ok(result_str)
    }
}
