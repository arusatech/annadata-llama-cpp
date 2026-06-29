/// Multi-model registry — up to N GGUF contexts resident; one active handler for dispatch.
use std::collections::HashMap;

pub const MAX_RESIDENT_MODELS: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    Chat,
    Embed,
    Other,
}

#[derive(Debug, Clone)]
pub struct ModelHandle {
    pub context_id: i64,
    pub kind: ModelKind,
}

#[derive(Debug, Clone)]
pub struct ModelRegistry {
    handles: HashMap<String, ModelHandle>,
    active_model_id: Option<String>,
    max_models: usize,
}

impl Default for ModelRegistry {
    fn default() -> Self {
        Self::new(MAX_RESIDENT_MODELS)
    }
}

impl ModelRegistry {
    pub fn new(max_models: usize) -> Self {
        ModelRegistry {
            handles: HashMap::new(),
            active_model_id: None,
            max_models: max_models.max(1),
        }
    }

    pub fn max_models(&self) -> usize {
        self.max_models
    }

    pub fn len(&self) -> usize {
        self.handles.len()
    }

    pub fn is_empty(&self) -> bool {
        self.handles.is_empty()
    }

    pub fn contains(&self, model_id: &str) -> bool {
        self.handles.contains_key(model_id)
    }

    pub fn active_model_id(&self) -> Option<&str> {
        self.active_model_id.as_deref()
    }

    pub fn register(
        &mut self,
        model_id: &str,
        context_id: i64,
        kind: ModelKind,
    ) -> Result<(), String> {
        if context_id <= 0 {
            return Err("Invalid context id".to_string());
        }
        if !self.contains(model_id) && self.len() >= self.max_models {
            return Err(format!(
                "Model slot limit reached ({}) — unload a model first",
                self.max_models
            ));
        }
        self.handles.insert(
            model_id.to_string(),
            ModelHandle {
                context_id,
                kind,
            },
        );
        if self.active_model_id.is_none() {
            self.active_model_id = Some(model_id.to_string());
        }
        Ok(())
    }

    pub fn unregister(&mut self, model_id: &str) -> Option<i64> {
        let removed = self.handles.remove(model_id).map(|h| h.context_id);
        if removed.is_some() && self.active_model_id.as_deref() == Some(model_id) {
            self.active_model_id = self.handles.keys().next().cloned();
        }
        removed
    }

    pub fn set_active(&mut self, model_id: &str) -> Result<(), String> {
        if !self.contains(model_id) {
            return Err(format!("Model '{}' is not loaded", model_id));
        }
        self.active_model_id = Some(model_id.to_string());
        Ok(())
    }

    /// Resolve context for inference: explicit model_id wins, else active handler.
    pub fn resolve_context(&self, model_id: &str) -> Result<i64, String> {
        let id = if model_id.is_empty() {
            self.active_model_id
                .as_deref()
                .ok_or_else(|| "No active model — load a model or pass model_id".to_string())?
        } else {
            model_id
        };
        self.handles
            .get(id)
            .map(|h| h.context_id)
            .ok_or_else(|| format!("Model '{}' is not loaded", id))
    }

    pub fn get_context(&self, model_id: &str) -> Option<i64> {
        self.handles.get(model_id).map(|h| h.context_id)
    }

    pub fn list(&self) -> Vec<(String, i64, ModelKind, bool)> {
        let active = self.active_model_id.as_deref();
        self.handles
            .iter()
            .map(|(id, h)| {
                (
                    id.clone(),
                    h.context_id,
                    h.kind,
                    active == Some(id.as_str()),
                )
            })
            .collect()
    }
}

pub fn kind_from_embedding_flag(embedding: bool) -> ModelKind {
    if embedding {
        ModelKind::Embed
    } else {
        ModelKind::Chat
    }
}
