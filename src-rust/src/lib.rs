mod engine;
#[cfg(llama_embed_cpp)]
mod ffi;
mod memory;
mod model;
#[allow(dead_code)]
mod stream;

use engine::EngineState;
use model::{
    CompletionParams, ContextParams, EmbedInput, EmbedRequest, EmbedResponse, GenerateRequest,
    GenerateResponse, ModelInitOptions,
};
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;

#[cfg(all(target_arch = "wasm32", not(llama_embed_cpp)))]
compile_error!(
    "llama_engine wasm builds require embedded llama.cpp. \
     Set LLAMA_WASM_EMBED_CPP=1 and build via npm run build:wasm (Emscripten)."
);

#[cfg(not(llama_embed_cpp))]
fn embedded_unavailable() -> JsValue {
    JsValue::from_str(
        "Embedded llama.cpp is not available in this build. Use npm run build:wasm (LLAMA_WASM_EMBED_CPP=1).",
    )
}

fn global_state() -> &'static Mutex<EngineState> {
    static STATE: OnceLock<Mutex<EngineState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(EngineState::new()))
}

/// Initialize the Wasm engine. Must be called before any other operations.
#[wasm_bindgen]
pub fn init() -> Result<(), JsValue> {
    let lock = global_state();
    let mut state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
    state.init();
    Ok(())
}

/// Load a model from raw bytes (#1 / #9).
/// The `bytes` parameter is the full GGUF model content read from OPFS
/// inside the Web Worker (not the main thread — fixes #9).
/// On Emscripten/WASI builds the bytes are written to a temp VFS path and
/// loaded; on the mock scaffold the model is registered with a stub context.
#[wasm_bindgen]
pub fn load_model(model_id: String, bytes: &[u8], opts_json: String) -> Result<(), JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        let lock = global_state();
        let mut state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }

        let opts: ModelInitOptions = serde_json::from_str(&opts_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid options JSON: {}", e)))?;

        // Build context parameters from opts (model_path is ignored for WASM —
        // bytes are the source of truth, fixing the silent-discard bug #1).
        let mut ctx_params = ContextParams::default();
        // Still populate model name from opts for logging / metadata purposes.
        ctx_params.model = opts.model_path.unwrap_or_else(|| model_id.clone());
        if let Some(n_ctx) = opts.n_ctx { ctx_params.n_ctx = n_ctx; }
        if let Some(n_threads) = opts.n_threads { ctx_params.n_threads = n_threads; }
        if let Some(n_batch) = opts.n_batch { ctx_params.n_batch = n_batch; }
        if let Some(n_gpu_layers) = opts.n_gpu_layers { ctx_params.n_gpu_layers = n_gpu_layers; }
        if let Some(embedding) = opts.embedding { ctx_params.embedding = embedding; }
        // Disable mmap for WASM — no real filesystem mmap available.
        ctx_params.use_mmap = false;
        if let Some(use_mlock) = opts.use_mlock { ctx_params.use_mlock = use_mlock; }

        let params_json = serde_json::to_string(&ctx_params)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize params: {}", e)))?;

        // Use bytes-based init so the model is loaded from the buffer the
        // worker read from OPFS, not from a (nonexistent) file path (#1).
        let context_id = ffi::init_context_from_buffer(bytes, &params_json)
            .map_err(|e| JsValue::from_str(&e))?;

        state.set_context(&model_id, context_id);
        Ok(())
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, bytes, opts_json);
        Err(embedded_unavailable())
    }
}

/// Unload a model and free its resources
#[wasm_bindgen]
pub fn unload_model(model_id: String) -> Result<(), JsValue> {
    let lock = global_state();
    let mut state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;

    #[cfg(llama_embed_cpp)]
    if let Some(context_id) = state.remove_context(&model_id) {
        ffi::release_context(context_id);
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = state.remove_context(&model_id);
    }

    Ok(())
}

/// Generate text from a prompt (non-streaming).
/// The global state mutex is released before calling into C to avoid
/// blocking all other WASM operations for the duration of inference (#2).
#[wasm_bindgen]
pub fn generate(model_id: String, req_json: String) -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        // Step 1: grab context_id then release the lock before inference (#2).
        let context_id = {
            let lock = global_state();
            let state = lock
                .lock()
                .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
            if !state.initialized {
                return Err(JsValue::from_str("Engine not initialized"));
            }
            state
                .get_context(&model_id)
                .ok_or_else(|| JsValue::from_str("Model not loaded"))?
        }; // lock released here

        let req: GenerateRequest = serde_json::from_str(&req_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid request JSON: {}", e)))?;

        let prompt = if let Some(prompt_text) = req.prompt {
            prompt_text
        } else if let Some(messages) = req.messages {
            messages
                .iter()
                .map(|m| format!("{}: {}", m.role, m.content))
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            return Err(JsValue::from_str("No prompt or messages provided"));
        };

        let mut comp_params = CompletionParams::default();
        comp_params.prompt = prompt;
        comp_params.n_predict = req.max_tokens.unwrap_or(128);
        comp_params.temperature = req.temperature.unwrap_or(0.7);
        comp_params.top_p = req.top_p.unwrap_or(0.95);
        comp_params.top_k = req.top_k.unwrap_or(40);
        comp_params.stop = req.stop;

        let params_json = serde_json::to_string(&comp_params)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize params: {}", e)))?;

        // Step 2: inference without holding the global state lock (#2).
        let raw = ffi::completion(context_id, &params_json)
            .map_err(|e| JsValue::from_str(&e))?;

        let completion_json: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| JsValue::from_str(&format!("Invalid completion response JSON: {}", e)))?;

        if let Some(error) = completion_json.get("error").and_then(|v| v.as_str()) {
            return Err(JsValue::from_str(error));
        }

        let response = GenerateResponse {
            text: completion_json
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            tokens_predicted: completion_json
                .get("tokens_predicted")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            tokens_evaluated: completion_json
                .get("tokens_evaluated")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            finish_reason: if completion_json
                .get("stopped_limit")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                "length".to_string()
            } else {
                "stop".to_string()
            },
        };

        serde_json::to_string(&response)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {}", e)))
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, req_json);
        Err(embedded_unavailable())
    }
}

/// Streaming generation: calls `on_token(token, index)` for each token (#3).
/// Uses `llama_completion_stream` which releases the global mutex between
/// the context lookup and the inference loop, fixing #2 for the WASM path.
#[wasm_bindgen]
pub fn generate_stream(
    model_id: String,
    req_json: String,
    on_token: js_sys::Function,
) -> Result<String, JsValue> {
    use std::ffi::CStr;
    use std::os::raw::{c_char, c_int, c_void};

    #[cfg(llama_embed_cpp)]
    {
        // Grab context_id then release the lock before inference (#2).
        let context_id = {
            let lock = global_state();
            let state = lock
                .lock()
                .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
            if !state.initialized {
                return Err(JsValue::from_str("Engine not initialized"));
            }
            state
                .get_context(&model_id)
                .ok_or_else(|| JsValue::from_str("Model not loaded"))?
        };

        let req: GenerateRequest = serde_json::from_str(&req_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid request JSON: {}", e)))?;

        let prompt = if let Some(p) = req.prompt {
            p
        } else if let Some(msgs) = req.messages {
            msgs.iter()
                .map(|m| format!("{}: {}", m.role, m.content))
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            return Err(JsValue::from_str("No prompt or messages provided"));
        };

        let mut comp_params = CompletionParams::default();
        comp_params.prompt = prompt;
        comp_params.n_predict = req.max_tokens.unwrap_or(128);
        comp_params.temperature = req.temperature.unwrap_or(0.7);
        comp_params.top_p = req.top_p.unwrap_or(0.95);
        comp_params.top_k = req.top_k.unwrap_or(40);
        comp_params.stop = req.stop;

        let params_json = serde_json::to_string(&comp_params)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize params: {}", e)))?;

        // Trampoline: bridges the C callback into the Rust closure that calls JS.
        // SAFETY: WASM is single-threaded; the pointer outlives the C call.
        struct CallbackState {
            f: js_sys::Function,
        }

        unsafe extern "C" fn token_trampoline(
            token: *const c_char,
            user_data: *mut c_void,
            index: c_int,
        ) {
            if token.is_null() || user_data.is_null() {
                return;
            }
            let cb = &*(user_data as *const CallbackState);
            let tok = CStr::from_ptr(token).to_str().unwrap_or("");
            let _ = cb.f.call2(
                &JsValue::null(),
                &JsValue::from_str(tok),
                &JsValue::from_f64(index as f64),
            );
        }

        let cb_state = CallbackState { f: on_token };
        let user_data = &cb_state as *const CallbackState as *mut c_void;

        let raw = unsafe {
            use std::ffi::CString;
            let params_cstr = CString::new(params_json.clone())
                .map_err(|e| JsValue::from_str(&format!("CString error: {}", e)))?;
            let result_ptr = ffi::llama_completion_stream(
                context_id,
                params_cstr.as_ptr(),
                token_trampoline,
                user_data,
            );
            if result_ptr.is_null() {
                return Err(JsValue::from_str("llama_completion_stream returned null"));
            }
            CStr::from_ptr(result_ptr)
                .to_str()
                .map_err(|e| JsValue::from_str(&format!("UTF-8 error: {}", e)))?
                .to_string()
        };

        Ok(raw)
    }

    #[cfg(not(llama_embed_cpp))]
    {
        // Mock scaffold: split the echo result into fake tokens via the callback.
        let result = generate(model_id, req_json)?;
        let parsed: serde_json::Value = serde_json::from_str(&result)
            .unwrap_or(serde_json::Value::Null);
        let text = parsed.get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let words: Vec<&str> = text.split_whitespace().collect();
        for (i, word) in words.iter().enumerate() {
            let tok = if i == 0 { word.to_string() } else { format!(" {}", word) };
            let _ = on_token.call2(
                &JsValue::null(),
                &JsValue::from_str(&tok),
                &JsValue::from_f64(i as f64),
            );
        }
        Ok(result)
    }
}

/// Generate embeddings for text
#[wasm_bindgen]
pub fn embed(model_id: String, req_json: String) -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        // Grab context_id then release lock before inference (#2).
        let context_id = {
            let lock = global_state();
            let state = lock
                .lock()
                .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
            if !state.initialized {
                return Err(JsValue::from_str("Engine not initialized"));
            }
            state
                .get_context(&model_id)
                .ok_or_else(|| JsValue::from_str("Model not loaded"))?
        };

        let request: EmbedRequest = serde_json::from_str(&req_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid embedding request JSON: {}", e)))?;

        let inputs: Vec<String> = match request.input {
            EmbedInput::Single(text) => vec![text],
            EmbedInput::Multiple(values) => values,
        };

        let mut vectors = Vec::with_capacity(inputs.len());
        for input in inputs {
            let vector =
                ffi::embedding(context_id, &input, "{}").map_err(|e| JsValue::from_str(&e))?;
            vectors.push(vector);
        }

        let response = EmbedResponse { vectors };
        serde_json::to_string(&response)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {}", e)))
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, req_json);
        Err(embedded_unavailable())
    }
}

/// Get health status of the engine
#[wasm_bindgen]
pub fn health() -> Result<String, JsValue> {
    let lock = global_state();
    let state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
    let payload = serde_json::json!({
        "ok": state.initialized,
        "loadedModels": state.contexts.len()
    });
    Ok(payload.to_string())
}

/// Get memory usage snapshot
#[wasm_bindgen]
pub fn memory_snapshot() -> Result<String, JsValue> {
    let snap = memory::snapshot();
    serde_json::to_string(&snap)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize memory snapshot: {}", e)))
}
