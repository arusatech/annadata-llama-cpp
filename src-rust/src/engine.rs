use std::collections::HashMap;

pub struct EngineState {
    pub initialized: bool,
    pub contexts: HashMap<String, i64>,
}

impl EngineState {
    pub fn new() -> Self {
        Self {
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

    pub fn remove_context(&mut self, model_id: &str) -> Option<i64> {
        self.contexts.remove(model_id)
    }

    pub fn get_context(&self, model_id: &str) -> Option<i64> {
        self.contexts.get(model_id).copied()
    }
}

