/// Rust FFI bindings to llama.cpp C/C++ functions
/// These are the foreign function declarations that link to the compiled llama.cpp library

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};

/// Extern C declarations for llama.cpp context management
#[link(name = "llama_engine_embedded_c", kind = "static")]
#[link(name = "llama_engine_embedded_cpp", kind = "static")]
extern "C" {
    /// Initialize a new inference context from a GGUF model file path
    pub fn llama_init_context(
        model_path: *const c_char,
        params_json: *const c_char,
    ) -> i64;

    /// Initialize a context directly from in-memory model bytes (#1 / #9).
    /// Available only in CAPLLAMA_BUILD_WASM builds; writes bytes to a
    /// temporary VFS path (Emscripten MEMFS or WASI /tmp/) then loads.
    pub fn llama_init_context_from_buffer(
        data: *const u8,
        size: usize,
        params_json: *const c_char,
    ) -> i64;

    /// Begin streaming a model file into MEMFS (OPFS sync-handle path, #9).
    pub fn llama_model_vfs_begin() -> *const c_char;

    /// Append a chunk to an in-progress VFS model file.
    pub fn llama_model_vfs_write(path: *const c_char, data: *const u8, len: usize) -> i32;

    /// Abort and remove a partial VFS model file.
    pub fn llama_model_vfs_abort(path: *const c_char);

    /// Close the VFS file and load the model from the written path.
    pub fn llama_model_vfs_finish(path: *const c_char, params_json: *const c_char) -> i64;

    /// Release a context and free its resources
    pub fn llama_release_context(context_id: i64);

    /// Run text completion/generation (synchronous, returns full result)
    pub fn llama_completion(
        context_id: i64,
        params_json: *const c_char,
    ) -> *const c_char;

    /// Streaming completion (#3): calls `token_callback` once per token.
    /// Holds g_mutex for the full inference (same as llama_completion).
    pub fn llama_completion_stream(
        context_id: i64,
        params_json: *const c_char,
        token_callback: unsafe extern "C" fn(*const c_char, *mut c_void, c_int),
        user_data: *mut c_void,
    ) -> *const c_char;

    /// Generate embeddings for input text — returns raw float* (use llama_embedding_json instead)
    pub fn llama_embedding(
        context_id: i64,
        text: *const c_char,
        params_json: *const c_char,
    ) -> *mut f32;

    /// Generate embeddings as JSON string {"embedding": [f32, ...]}
    /// Safe wrapper over llama_embedding that serialises the float array and size.
    pub fn llama_embedding_json(
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

/// Safe wrapper for initializing a context from raw in-memory model bytes (#1).
/// Only available when the embedded C++ is compiled in (CAPLLAMA_BUILD_WASM).
pub fn init_context_from_buffer(bytes: &[u8], params_json: &str) -> Result<i64, String> {
    let params_cstr = CString::new(params_json)
        .map_err(|e| format!("Invalid params JSON: {}", e))?;

    unsafe {
        let id = llama_init_context_from_buffer(
            bytes.as_ptr(),
            bytes.len(),
            params_cstr.as_ptr(),
        );
        if id <= 0 {
            return Err("llama_init_context_from_buffer failed — check that the WASM VFS (/tmp/) is available".to_string());
        }
        Ok(id)
    }
}

/// Begin a streaming VFS write for OPFS sync-handle model loading (#9).
pub fn model_vfs_begin() -> Result<String, String> {
    unsafe {
        let path_ptr = llama_model_vfs_begin();
        if path_ptr.is_null() {
            return Err("llama_model_vfs_begin failed — MEMFS may be unavailable".to_string());
        }
        CStr::from_ptr(path_ptr)
            .to_str()
            .map(|s| s.to_string())
            .map_err(|e| format!("Invalid VFS path: {}", e))
    }
}

/// Write one chunk to an in-progress VFS model file.
pub fn model_vfs_write(path: &str, chunk: &[u8]) -> Result<(), String> {
    let path_cstr = CString::new(path).map_err(|e| format!("Invalid VFS path: {}", e))?;
    unsafe {
        let rc = llama_model_vfs_write(path_cstr.as_ptr(), chunk.as_ptr(), chunk.len());
        if rc != 0 {
            return Err("llama_model_vfs_write failed".to_string());
        }
    }
    Ok(())
}

/// Abort a partial VFS model write.
pub fn model_vfs_abort(path: &str) {
    if let Ok(path_cstr) = CString::new(path) {
        unsafe {
            llama_model_vfs_abort(path_cstr.as_ptr());
        }
    }
}

/// Finish the VFS write and load the model.
pub fn model_vfs_finish(path: &str, params_json: &str) -> Result<i64, String> {
    let path_cstr = CString::new(path).map_err(|e| format!("Invalid VFS path: {}", e))?;
    let params_cstr = CString::new(params_json)
        .map_err(|e| format!("Invalid params JSON: {}", e))?;
    unsafe {
        let id = llama_model_vfs_finish(path_cstr.as_ptr(), params_cstr.as_ptr());
        if id <= 0 {
            return Err("llama_model_vfs_finish failed — model may be invalid".to_string());
        }
        Ok(id)
    }
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
        llama_release_context(context_id);
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

/// Safe wrapper for embedding — calls `llama_embedding_json` which returns a proper JSON string.
pub fn embedding(context_id: i64, text: &str, params_json: &str) -> Result<Vec<f32>, String> {
    let text_cstr = CString::new(text)
        .map_err(|e| format!("Invalid text: {}", e))?;
    let params_cstr = CString::new(params_json)
        .map_err(|e| format!("Invalid params JSON: {}", e))?;

    unsafe {
        let result_ptr =
            llama_embedding_json(context_id, text_cstr.as_ptr(), params_cstr.as_ptr());
        if result_ptr.is_null() {
            return Err("Embedding returned null".to_string());
        }

        let result_cstr = CStr::from_ptr(result_ptr);
        let result_str = result_cstr
            .to_str()
            .map_err(|e| format!("Invalid UTF-8 in embedding result: {}", e))?;

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

/// Safe wrapper for streaming completion (#3).
/// Calls `on_token(token_text, index)` for every generated token.
/// The C++ g_mutex is held for the full inference (same as llama_completion).
pub fn completion_stream<F>(
    context_id: i64,
    params_json: &str,
    mut on_token: F,
) -> Result<String, String>
where
    F: FnMut(&str, i32),
{
    let params_cstr = CString::new(params_json)
        .map_err(|e| format!("Invalid params JSON: {}", e))?;

    // Use a fat pointer (trait object) as user_data so the closure can
    // capture local variables without any extra allocation trickery.
    type BoxedFn<'a> = &'a mut dyn FnMut(&str, i32);

    unsafe extern "C" fn trampoline(
        token: *const c_char,
        user_data: *mut c_void,
        index: c_int,
    ) {
        let cb = &mut *(user_data as *mut BoxedFn<'_>);
        if token.is_null() {
            return;
        }
        let tok = CStr::from_ptr(token).to_str().unwrap_or("");
        cb(tok, index as i32);
    }

    let mut erased: BoxedFn<'_> = &mut on_token;
    let user_data = &mut erased as *mut BoxedFn<'_> as *mut c_void;

    unsafe {
        let result_ptr = llama_completion_stream(
            context_id,
            params_cstr.as_ptr(),
            trampoline,
            user_data,
        );
        if result_ptr.is_null() {
            return Err("completion_stream returned null".to_string());
        }
        let result_cstr = CStr::from_ptr(result_ptr);
        Ok(result_cstr
            .to_str()
            .map_err(|e| format!("Invalid UTF-8 in stream result: {}", e))?
            .to_string())
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
