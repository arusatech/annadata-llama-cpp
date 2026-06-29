/// Engine state — multi-model registry + active handler (no unload-to-switch).

use crate::model_registry::{ModelKind, ModelRegistry, MAX_RESIDENT_MODELS};

pub struct EngineState {
    pub initialized: bool,
    registry: ModelRegistry,
}

impl EngineState {
    pub fn new() -> Self {
        EngineState {
            initialized: false,
            registry: ModelRegistry::new(MAX_RESIDENT_MODELS),
        }
    }

    pub fn init(&mut self) {
        self.initialized = true;
    }

    pub fn registry(&self) -> &ModelRegistry {
        &self.registry
    }

    pub fn registry_mut(&mut self) -> &mut ModelRegistry {
        &mut self.registry
    }

    pub fn set_context(&mut self, model_id: &str, context_id: i64, kind: ModelKind) {
        let _ = self.registry.register(model_id, context_id, kind);
    }

    pub fn get_context(&self, model_id: &str) -> Option<i64> {
        self.registry.get_context(model_id)
    }

    pub fn resolve_context(&self, model_id: &str) -> Result<i64, String> {
        self.registry.resolve_context(model_id)
    }

    pub fn remove_context(&mut self, model_id: &str) -> Option<i64> {
        self.registry.unregister(model_id)
    }

    pub fn set_active_model(&mut self, model_id: &str) -> Result<(), String> {
        self.registry.set_active(model_id)
    }

    pub fn active_model_id(&self) -> Option<&str> {
        self.registry.active_model_id()
    }

    /// Back-compat alias for health() — number of resident models.
    pub fn contexts(&self) -> &ModelRegistry {
        &self.registry
    }

    pub fn list_contexts(&self) -> Vec<(String, i64)> {
        self.registry
            .list()
            .into_iter()
            .map(|(id, ctx, _, _)| (id, ctx))
            .collect()
    }
}
