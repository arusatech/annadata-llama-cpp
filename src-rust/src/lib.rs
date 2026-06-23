mod engine;
#[cfg(llama_embed_cpp)]
mod ffi;
mod memory;
mod model;
mod stream;

use engine::EngineState;
use model::{EmbedInput, EmbedRequest, EmbedResponse, GenerateRequest, GenerateResponse};
use std::sync::{Mutex, OnceLock};
use wasm_bindgen::prelude::*;

fn global_state() -> &'static Mutex<EngineState> {
    static STATE: OnceLock<Mutex<EngineState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(EngineState::new()))
}

#[wasm_bindgen]
pub fn init() -> Result<(), JsValue> {
    let lock = global_state();
    let mut state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
    state.init();
    Ok(())
}

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

    let opts_value: serde_json::Value =
        serde_json::from_str(&opts_json).unwrap_or_else(|_| serde_json::json!({}));
    let model_path = opts_value
        .get("modelPath")
        .and_then(|v| v.as_str())
        .or_else(|| opts_value.get("model_path").and_then(|v| v.as_str()))
        .ok_or_else(|| {
            JsValue::from_str(
                "modelPath is required for current llama.cpp wasm bridge. \
in-memory model bytes are not yet supported by this execution path.",
            )
        })?;

    let context_id = ffi::init_context(model_path, &opts_json).map_err(|e| JsValue::from_str(&e))?;
    state.set_context(&model_id, context_id);

    // Keep signature parity with wasm-bindgen wrapper; bytes will be used once in-memory loading is added.
    let _ = bytes;
    Ok(())
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let lock = global_state();
        let mut state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }
        let _ = opts_json;
        state.set_context(&model_id, 1);
        let _ = bytes;
        Ok(())
    }
}

#[wasm_bindgen]
pub fn unload_model(model_id: String) -> Result<(), JsValue> {
    let lock = global_state();
    let mut state = lock
        .lock()
        .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
    #[cfg(llama_embed_cpp)]
    {
    if let Some(context_id) = state.remove_context(&model_id) {
        ffi::release_context(context_id);
    }
    }
    #[cfg(not(llama_embed_cpp))]
    {
        let _ = state.remove_context(&model_id);
    }
    Ok(())
}

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
        .map_err(|e| JsValue::from_str(&format!("Invalid request JSON: {e}")))?;

    let completion_payload = serde_json::json!({
        "prompt": req.prompt.unwrap_or_default(),
        "n_predict": req.max_tokens.unwrap_or(128),
        "temperature": req.temperature.unwrap_or(0.7),
    });

    let raw = ffi::completion(context_id, &completion_payload.to_string())
        .map_err(|e| JsValue::from_str(&e))?;
    let completion_json: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| JsValue::from_str(&format!("Invalid completion response JSON: {e}")))?;

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
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {e}")))
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let lock = global_state();
        let state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }
        if state.get_context(&model_id).is_none() {
            return Err(JsValue::from_str("Model not loaded"));
        }
        let req: GenerateRequest = serde_json::from_str(&req_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid request JSON: {e}")))?;
        let response = GenerateResponse {
            text: format!("(wasm scaffold) {}", req.prompt.unwrap_or_default()),
            tokens_predicted: 0,
            tokens_evaluated: 0,
            finish_reason: "stop".to_string(),
        };
        serde_json::to_string(&response)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize response: {e}")))
    }
}

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
        .map_err(|e| JsValue::from_str(&format!("Invalid embedding request JSON: {e}")))?;

    let inputs: Vec<String> = match request.input {
        EmbedInput::Single(text) => vec![text],
        EmbedInput::Multiple(values) => values,
    };

    let mut vectors = Vec::with_capacity(inputs.len());
    for input in inputs {
        let vector = ffi::embedding(context_id, &input, "{}").map_err(|e| JsValue::from_str(&e))?;
        vectors.push(vector);
    }

    let response = EmbedResponse { vectors };
    serde_json::to_string(&response)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize embedding response: {e}")))
    }

    #[cfg(not(llama_embed_cpp))]
    {
        let lock = global_state();
        let state = lock
            .lock()
            .map_err(|_| JsValue::from_str("Failed to acquire engine state lock"))?;
        if !state.initialized {
            return Err(JsValue::from_str("Engine not initialized"));
        }
        if state.get_context(&model_id).is_none() {
            return Err(JsValue::from_str("Model not loaded"));
        }
        let request: EmbedRequest = serde_json::from_str(&req_json)
            .map_err(|e| JsValue::from_str(&format!("Invalid embedding request JSON: {e}")))?;
        let count = match request.input {
            EmbedInput::Single(_) => 1,
            EmbedInput::Multiple(v) => v.len(),
        };
        let response = EmbedResponse {
            vectors: vec![vec![]; count],
        };
        serde_json::to_string(&response)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize embedding response: {e}")))
    }
}

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

#[wasm_bindgen]
pub fn memory_snapshot() -> Result<String, JsValue> {
    let snap = memory::snapshot();
    serde_json::to_string(&snap)
        .map_err(|e| JsValue::from_str(&format!("Failed to serialize memory snapshot: {e}")))
}

