interface BindgenModule {
    /* tslint:disable */
    /* eslint-disable */
    embed(model_id: string, req_json: string): string;
    generate(model_id: string, req_json: string): string;
    health(): string;
    init(): void;
    load_model(model_id: string, bytes: Uint8Array, opts_json: string): void;
    memory_snapshot(): string;
    unload_model(model_id: string): void;
}

export { BindgenModule };
