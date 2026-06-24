/// Engine state management for Wasm inference
/// Manages context lifecycle and model handles

use std::collections::HashMap;
use std::sync::Mutex;

/// Global engine state containing active contexts
pub struct EngineState {
    pub initialized: bool,
    pub contexts: HashMap<String, i64>, // modelId -> context_id mapping
}

impl EngineState {
    pub fn new() -> Self {
        EngineState {
            initialized: false,
            contexts: HashMap::new(),
        }
    }

    pub fn init(&mut self) {
        self.initialized = true;
    }

    pub fn set_context(&mut self, model_id: &str, context_id: i64) {
        self.contexts.insert(model_id.to_string(), context_id);
    }

    pub fn get_context(&self, model_id: &str) -> Option<i64> {
        self.contexts.get(model_id).copied()
    }

    pub fn remove_context(&mut self, model_id: &str) -> Option<i64> {
        self.contexts.remove(model_id)
    }

    pub fn list_contexts(&self) -> Vec<(String, i64)> {
        self.contexts
            .iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect()
    }
}
