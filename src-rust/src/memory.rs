use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct MemorySnapshot {
    pub pressure: &'static str,
}

pub fn snapshot() -> MemorySnapshot {
    // Placeholder until wasm-side allocator telemetry is wired.
    MemorySnapshot { pressure: "unknown" }
}

