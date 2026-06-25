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

/// Load a model from a file path. The model must be in GGUF format.
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

        let model_path = opts
            .model_path
            .ok_or_else(|| JsValue::from_str("modelPath is required"))?;

        let mut ctx_params = ContextParams::default();
        ctx_params.model = model_path;
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
        if let Some(use_mmap) = opts.use_mmap {
            ctx_params.use_mmap = use_mmap;
        }
        if let Some(use_mlock) = opts.use_mlock {
            ctx_params.use_mlock = use_mlock;
        }

        let params_json = serde_json::to_string(&ctx_params)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize params: {}", e)))?;

        // On Emscripten (wasm build), write the model bytes into the virtual filesystem
        // so that llama_init_context can open the file via the standard path API.
        // bytes is the raw GGUF content passed from the browser (OPFS → ArrayBuffer → &[u8]).
        #[cfg(target_os = "emscripten")]
        {
            use std::io::Write;
            if let Some(parent) = std::path::Path::new(&ctx_params.model).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut f = std::fs::File::create(&ctx_params.model)
                .map_err(|e| JsValue::from_str(&format!("MEMFS write failed: {}", e)))?;
            f.write_all(bytes)
                .map_err(|e| JsValue::from_str(&format!("MEMFS write failed: {}", e)))?;
        }
        #[cfg(not(target_os = "emscripten"))]
        {
            let _ = bytes;
        }

        let context_id =
            ffi::init_context(&ctx_params.model, &params_json).map_err(|e| JsValue::from_str(&e))?;

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

/// Generate text from a prompt
#[wasm_bindgen]
pub fn generate(model_id: String, req_json: String) -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        let lock = global_state();
        let state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }
        let context_id = state
            .get_context(&model_id)
            .ok_or_else(|| JsValue::from_str("Model not loaded"))?;

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

        let raw = ffi::completion(context_id, &params_json).map_err(|e| JsValue::from_str(&e))?;

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

/// Generate embeddings for text
#[wasm_bindgen]
pub fn embed(model_id: String, req_json: String) -> Result<String, JsValue> {
    #[cfg(llama_embed_cpp)]
    {
        let lock = global_state();
        let state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }
        let context_id = state
            .get_context(&model_id)
            .ok_or_else(|| JsValue::from_str("Model not loaded"))?;

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
