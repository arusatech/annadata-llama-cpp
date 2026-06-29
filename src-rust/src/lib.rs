mod engine;
#[cfg(llama_embed_cpp)]
mod ffi;
mod memory;
mod model;
mod model_registry;
#[allow(dead_code)]
mod stream;

use engine::EngineState;
use model::{
    CompletionParams, ContextParams, EmbedInput, EmbedRequest, EmbedResponse, GenerateRequest,
    GenerateResponse, ModelInitOptions,
};
use model_registry::kind_from_embedding_flag;
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

fn js_string_err(e: String) -> JsValue {
    JsValue::from_str(&e)
}

fn register_loaded_model(
    state: &mut EngineState,
    model_id: &str,
    context_id: i64,
    embedding: bool,
) -> Result<(), JsValue> {
    let kind = kind_from_embedding_flag(embedding);
    state
        .registry_mut()
        .register(model_id, context_id, kind)
        .map_err(js_string_err)?;
    Ok(())
}

fn context_params_from_opts(model_id: &str, opts: &ModelInitOptions) -> Result<ContextParams, JsValue> {
    let mut ctx_params = ContextParams::default();
    ctx_params.model = opts
        .model_path
        .clone()
        .unwrap_or_else(|| model_id.to_string());
    if let Some(n_ctx) = opts.n_ctx {
        ctx_params.n_ctx = n_ctx;
    }
    if let Some(n_threads) = opts.n_threads {
        ctx_params.n_threads = n_threads;
    }
    if let Some(n_batch) = opts.n_batch {
        ctx_params.n_batch = n_batch;
    }
    if let Some(n_gpu_layers) = opts.n_gpu_layers {
        ctx_params.n_gpu_layers = n_gpu_layers;
    }
    if let Some(embedding) = opts.embedding {
        ctx_params.embedding = embedding;
    }
    ctx_params.use_mmap = false;
    if let Some(use_mlock) = opts.use_mlock {
        ctx_params.use_mlock = use_mlock;
    }
    Ok(ctx_params)
}

/// JSPI + wasm-bindgen describe can swap the 2nd/3rd string args (vfs_path ↔ opts_json).
fn normalize_vfs_and_opts(vfs_path: String, opts_json: String) -> (String, String) {
    let vfs_looks_like_json = vfs_path.trim_start().starts_with('{');
    let opts_looks_like_path = opts_json.starts_with('/');
    if vfs_looks_like_json && opts_looks_like_path {
        (opts_json, vfs_path)
    } else {
        (vfs_path, opts_json)
    }
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

/// Load a model from raw bytes (legacy fallback — choice 1).
/// Production web loads use choice 3: OPFS sync-handle streaming via
/// `model_vfs_begin` / `model_vfs_write` / `load_model_from_vfs` so the
/// full GGUF is never held in the JS heap at once.
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

        let ctx_params = context_params_from_opts(&model_id, &opts)?;
        let embedding = ctx_params.embedding;
        let params_json = serde_json::to_string(&ctx_params)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize params: {}", e)))?;

        let context_id = ffi::init_context_from_buffer(bytes, &params_json)
            .map_err(|e| JsValue::from_str(&e))?;

        register_loaded_model(&mut state, &model_id, context_id, embedding)?;
        Ok(())
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, bytes, opts_json);
        Err(embedded_unavailable())
    }
}

/// Begin streaming a model from OPFS sync-handle chunks into MEMFS (choice 3).
/// Returns the temporary VFS path to pass to `model_vfs_write` / `load_model_from_vfs`.
#[wasm_bindgen]
pub fn model_vfs_begin() -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        ffi::model_vfs_begin().map_err(|e| JsValue::from_str(&e))
    }
    #[cfg(not(llama_embed_cpp))]
    {
        Err(embedded_unavailable())
    }
}

/// Append one chunk to a VFS model file opened via `model_vfs_begin`.
#[wasm_bindgen]
pub fn model_vfs_write(vfs_path: String, chunk: &[u8]) -> Result<(), JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        ffi::model_vfs_write(&vfs_path, chunk).map_err(|e| JsValue::from_str(&e))
    }
    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (vfs_path, chunk);
        Err(embedded_unavailable())
    }
}

/// Abort a partial VFS model write and remove the temp file.
#[wasm_bindgen]
pub fn model_vfs_abort(vfs_path: String) {
    #[cfg(llama_embed_cpp)]
    {
        ffi::model_vfs_abort(&vfs_path);
    }
    #[cfg(not(llama_embed_cpp))]
    {
        let _ = vfs_path;
    }
}

/// Finish a streamed VFS model write and register the loaded model.
#[wasm_bindgen]
pub fn load_model_from_vfs(model_id: String, vfs_path: String, opts_json: String) -> Result<(), JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        let lock = global_state();
        let mut state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }

        let (vfs_path, opts_json) = normalize_vfs_and_opts(vfs_path, opts_json);
        let opts: ModelInitOptions = serde_json::from_str(&opts_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid options JSON: {}", e)))?;
        let embedding = opts.embedding.unwrap_or(false);
        let context_id = ffi::model_vfs_finish(&vfs_path, &opts_json)
            .map_err(|e| JsValue::from_str(&e))?;
        register_loaded_model(&mut state, &model_id, context_id, embedding)?;
        Ok(())
    }
    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, vfs_path, opts_json);
        Err(embedded_unavailable())
    }
}

/// Load a model from an existing VFS path (HeapFS — file already in WASM linear memory).
#[wasm_bindgen]
pub fn load_model_from_path(model_id: String, vfs_path: String, opts_json: String) -> Result<(), JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        let lock = global_state();
        let mut state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }

        let (vfs_path, opts_json) = normalize_vfs_and_opts(vfs_path, opts_json);
        let opts: ModelInitOptions = serde_json::from_str(&opts_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid options JSON: {}", e)))?;
        let embedding = opts.embedding.unwrap_or(false);
        let context_id = ffi::load_context_from_path(&vfs_path, &opts_json)
            .map_err(|e| JsValue::from_str(&e))?;
        register_loaded_model(&mut state, &model_id, context_id, embedding)?;
        Ok(())
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, vfs_path, opts_json);
        Err(embedded_unavailable())
    }
}

/// Register a context id returned by `llama_load_context_from_path` (JS cwrap path).
#[wasm_bindgen]
pub fn register_model_context(model_id: String, context_id: i64) -> Result<(), JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        if context_id <= 0 {
            return Err(JsValue::from_str("Invalid context id"));
        }
        let lock = global_state();
        let mut state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }
        register_loaded_model(&mut state, &model_id, context_id, false)?;
        Ok(())
    }
    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, context_id);
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

/// Point the active inference handler at a loaded model (weights stay resident).
#[wasm_bindgen]
pub fn set_active_model(model_id: String) -> Result<(), JsValue> {
    let lock = global_state();
    let mut state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
    state
        .set_active_model(&model_id)
        .map_err(js_string_err)
}

/// Return the model id currently selected by the active handler.
#[wasm_bindgen]
pub fn get_active_model() -> Result<String, JsValue> {
    let lock = global_state();
    let state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
    state
        .active_model_id()
        .map(|s| s.to_string())
        .ok_or_else(|| JsValue::from_str("No active model"))
}

/// List resident models, context ids, kinds, and which one is active.
#[wasm_bindgen]
pub fn list_loaded_models() -> Result<String, JsValue> {
    use model_registry::ModelKind;

    let lock = global_state();
    let state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;

    let models: Vec<serde_json::Value> = state
        .registry()
        .list()
        .into_iter()
        .map(|(id, ctx, kind, active)| {
            let kind_str = match kind {
                ModelKind::Chat => "chat",
                ModelKind::Embed => "embed",
                ModelKind::Other => "other",
            };
            serde_json::json!({
                "modelId": id,
                "contextId": ctx,
                "kind": kind_str,
                "active": active,
            })
        })
        .collect();

    let payload = serde_json::json!({
        "maxModels": model_registry::MAX_RESIDENT_MODELS,
        "loadedCount": models.len(),
        "activeModelId": state.active_model_id(),
        "models": models,
    });

    serde_json::to_string(&payload)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize model list: {}", e)))
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
                .resolve_context(&model_id)
                .map_err(js_string_err)?
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

        if completion_json.is_number() {
            return Err(JsValue::from_str(&format!(
                "Invalid completion: bare number in C++ response ({}) — reload model after wasm update",
                raw.chars().take(64).collect::<String>()
            )));
        }
        if !completion_json.is_object() {
            return Err(JsValue::from_str(&format!(
                "Invalid completion JSON type (expected object): {}",
                raw.chars().take(120).collect::<String>()
            )));
        }

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
///
/// When built with JSPI (`LLAMA_WASM_JSPI=1`), tokens are delivered incrementally
/// via `Module.__llamaStreamOnToken` (EM_ASYNC_JS in C++). Otherwise tokens are
/// buffered in Rust and delivered after inference completes.
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
        let context_id = {
            let lock = global_state();
            let state = lock
                .lock()
                .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
            if !state.initialized {
                return Err(JsValue::from_str("Engine not initialized"));
            }
            state
                .resolve_context(&model_id)
                .map_err(js_string_err)?
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

        #[cfg(capllama_wasm_jspi)]
        unsafe extern "C" fn stream_trampoline(
            _token: *const c_char,
            _user_data: *mut c_void,
            _index: c_int,
        ) {
            // Tokens dispatched via EM_ASYNC_JS → Module.__llamaStreamOnToken in C++.
        }

        #[cfg(not(capllama_wasm_jspi))]
        struct TokenCollector {
            tokens: Vec<String>,
        }

        #[cfg(not(capllama_wasm_jspi))]
        unsafe extern "C" fn stream_trampoline(
            token: *const c_char,
            user_data: *mut c_void,
            _index: c_int,
        ) {
            if token.is_null() || user_data.is_null() {
                return;
            }
            let collector = &mut *(user_data as *mut TokenCollector);
            if let Ok(tok) = CStr::from_ptr(token).to_str() {
                if !tok.is_empty() {
                    collector.tokens.push(tok.to_string());
                }
            }
        }

        #[cfg(not(capllama_wasm_jspi))]
        let mut collector = TokenCollector { tokens: Vec::new() };

        #[cfg(not(capllama_wasm_jspi))]
        let user_data = &mut collector as *mut TokenCollector as *mut c_void;

        #[cfg(capllama_wasm_jspi)]
        let user_data = std::ptr::null_mut();

        let raw = unsafe {
            use std::ffi::CString;
            let params_cstr = CString::new(params_json)
                .map_err(|e| JsValue::from_str(&format!("CString error: {}", e)))?;
            let result_ptr = ffi::llama_completion_stream(
                context_id,
                params_cstr.as_ptr(),
                stream_trampoline,
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

        #[cfg(not(capllama_wasm_jspi))]
        for (index, token) in collector.tokens.iter().enumerate() {
            let _ = on_token.call2(
                &JsValue::null(),
                &JsValue::from_str(token),
                &JsValue::from_f64(index as f64),
            );
        }

        #[cfg(capllama_wasm_jspi)]
        let _ = on_token;

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
                .resolve_context(&model_id)
                .map_err(js_string_err)?
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

/// Tokenize text using a loaded model's vocabulary.
/// Returns a JSON object: `{ "tokens": [i32, ...], "has_media": bool }`.
#[wasm_bindgen]
pub fn tokenize(model_id: String, text: String) -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        let context_id = {
            let lock = global_state();
            let state = lock
                .lock()
                .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
            if !state.initialized {
                return Err(JsValue::from_str("Engine not initialized"));
            }
            state
                .resolve_context(&model_id)
                .map_err(js_string_err)?
        };

        let raw = ffi::tokenize(context_id, &text)
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(raw)
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, text);
        Err(embedded_unavailable())
    }
}

/// Detokenize a JSON array of token IDs back to a text string.
/// Input: JSON string representing an array of integers, e.g. `[1, 2, 3]`.
/// Returns a JSON object: `{ "text": "..." }`.
#[wasm_bindgen]
pub fn detokenize(model_id: String, tokens_json: String) -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        let context_id = {
            let lock = global_state();
            let state = lock
                .lock()
                .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
            if !state.initialized {
                return Err(JsValue::from_str("Engine not initialized"));
            }
            state
                .resolve_context(&model_id)
                .map_err(js_string_err)?
        };

        let tokens: Vec<i32> = serde_json::from_str(&tokens_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid tokens JSON: {}", e)))?;

        let text = ffi::detokenize(context_id, &tokens)
            .map_err(|e| JsValue::from_str(&e))?;

        let response = serde_json::json!({ "text": text });
        serde_json::to_string(&response)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {}", e)))
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = (model_id, tokens_json);
        Err(embedded_unavailable())
    }
}

/// Convert a JSON Schema string to a GBNF grammar string for constrained sampling.
/// This is context-free and does not require a model to be loaded.
#[wasm_bindgen]
pub fn convert_json_schema_to_grammar(schema_json: String) -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        ffi::convert_json_schema_to_grammar(&schema_json)
            .map_err(|e| JsValue::from_str(&e))
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let _ = schema_json;
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
        "loadedModels": state.registry().len(),
        "maxModels": model_registry::MAX_RESIDENT_MODELS,
        "activeModelId": state.active_model_id(),
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
