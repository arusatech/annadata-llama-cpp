/**
 * In-process HTTP server (127.0.0.1 by default) backed by the same GGUF stack as
 * the Capacitor bridge. This is the supported way to expose a localhost API from
 * native code on device; it is not the full upstream llama.cpp tools/server binary.
 */

#ifndef CAP_NATIVE_SERVER_H
#define CAP_NATIVE_SERVER_H

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Start the server on a background thread. Loads the model via llama_init_context.
 * @param model_path Absolute path to the GGUF file (e.g. under app storage).
 * @param host Bind address; use "127.0.0.1" for loopback-only.
 * @param port TCP port (e.g. 8080).
 * @param params_json Optional JSON for llama_init_context (n_ctx, n_gpu_layers, etc.).
 * @return 1 on success, 0 on failure.
 */
int cap_llama_server_start(const char * model_path, const char * host, int port, const char * params_json);

/** Stops listening, joins the server thread, and releases the server context. */
void cap_llama_server_stop(void);

/** Non-zero if the server thread was started and is still running. */
int cap_llama_server_is_running(void);

/**
 * argv-style entry (similar to llama-server): -m/--model, --host, --port, -c/--ctx-size.
 * argv[0] is ignored. Returns 0 on success.
 */
int cap_llama_server_main(int argc, char ** argv);

#ifdef __cplusplus
}
#endif

#endif
