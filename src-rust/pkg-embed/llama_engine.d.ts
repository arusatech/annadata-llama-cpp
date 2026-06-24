interface BindgenModule {
    /* tslint:disable */
    /* eslint-disable */
    /**
     * Generate embeddings for text
     */
    embed(model_id: string, req_json: string): string;
    /**
     * Generate text from a prompt
     */
    generate(model_id: string, req_json: string): string;
    /**
     * Get health status of the engine
     */
    health(): string;
    /**
     * Initialize the Wasm engine. Must be called before any other operations.
     */
    init(): void;
    /**
     * Load a model from a file path. The model must be in GGUF format.
     */
    load_model(model_id: string, bytes: Uint8Array, opts_json: string): void;
    /**
     * Get memory usage snapshot
     */
    memory_snapshot(): string;
    /**
     * Unload a model and free its resources
     */
    unload_model(model_id: string): void;
}

export { BindgenModule };
