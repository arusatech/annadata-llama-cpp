/// Memory management and statistics for Wasm inference

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySnapshot {
    pub available_mb: f64,
    pub total_mb: f64,
    pub pressure: String, // "low", "medium", "high", "unknown"
}

/// Get current memory snapshot
pub fn snapshot() -> MemorySnapshot {
    // In Wasm, we can only report via performance.memory API on the JS side
    // This function provides reasonable defaults
    MemorySnapshot {
        available_mb: 0.0,
        total_mb: 0.0,
        pressure: "unknown".to_string(),
    }
}

/// Check if memory pressure is acceptable for model loading
pub fn check_memory_pressure(model_size_mb: f64) -> Result<(), String> {
    let mem = snapshot();
    
    if mem.pressure == "high" {
        return Err(format!(
            "High memory pressure detected. Model size: {}MB",
            model_size_mb
        ));
    }
    
    Ok(())
}
