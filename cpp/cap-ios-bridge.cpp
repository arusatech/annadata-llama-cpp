// iOS / dlsym C bridge — mirrors android/jni.cpp context lifecycle and core calls.

#include "cap-llama.h"
#include "cap-completion.h"
#include "json-schema-to-grammar.h"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <algorithm>
#include <filesystem>
#ifdef __EMSCRIPTEN__
#include <unistd.h>
#endif
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "nlohmann/json.hpp"

using json = nlohmann::ordered_json;

bool capllama_verbose = false;

extern "C" void llama_embedding_register_context(int64_t contextId, void * contextPtr);
extern "C" void llama_embedding_unregister_context(int64_t contextId);

namespace {

std::mutex g_mutex;
std::map<int64_t, std::unique_ptr<capllama::llama_cap_context>> g_contexts;
int64_t g_next_id = 1;

thread_local std::string g_tls_str;

const char * tls_cstr(const std::string & s) {
    g_tls_str = s;
    return g_tls_str.c_str();
}

capllama::llama_cap_context * get_ctx(int64_t id) {
    auto it = g_contexts.find(id);
    if (it == g_contexts.end() || !it->second) {
        return nullptr;
    }
    return it->second.get();
}

void apply_params_json(common_params & cparams, const json * j) {
    if (!j || !j->is_object()) {
        return;
    }
    const json & p = *j;
    try {
        if (p.contains("embedding") && p["embedding"].is_boolean()) {
            cparams.embedding = p["embedding"].get<bool>();
        }
        if (p.contains("n_ctx") && p["n_ctx"].is_number_integer()) {
            cparams.n_ctx = p["n_ctx"].get<int>();
        }
        if (p.contains("n_batch") && p["n_batch"].is_number_integer()) {
            cparams.n_batch = p["n_batch"].get<int>();
        }
        if (p.contains("n_threads") && p["n_threads"].is_number_integer()) {
            cparams.cpuparams.n_threads = p["n_threads"].get<int>();
            cparams.cpuparams_batch.n_threads = p["n_threads"].get<int>();
        }
        if (p.contains("n_gpu_layers") && p["n_gpu_layers"].is_number_integer()) {
            cparams.n_gpu_layers = p["n_gpu_layers"].get<int>();
        }
        if (p.contains("use_mmap") && p["use_mmap"].is_boolean()) {
            cparams.use_mmap = p["use_mmap"].get<bool>();
        }
        if (p.contains("use_mlock") && p["use_mlock"].is_boolean()) {
            cparams.use_mlock = p["use_mlock"].get<bool>();
        }
        if (p.contains("chat_template") && p["chat_template"].is_string()) {
            cparams.chat_template = p["chat_template"].get<std::string>();
        }
    } catch (...) {
    }
}

static bool vfs_path_exists(const std::string & path) {
    if (path.empty()) {
        return false;
    }
#ifdef __EMSCRIPTEN__
    // Files written via Emscripten FS.open/write are visible to fopen/access but
    // std::filesystem::exists can return false for MEMFS paths in some builds.
    if (path[0] == '/') {
        return access(path.c_str(), F_OK) == 0;
    }
#endif
    return std::filesystem::exists(path);
}

std::string resolve_model_path(const std::string & primary, const json * params_j) {
    std::vector<std::string> candidates;
    candidates.push_back(primary);
    if (params_j && params_j->contains("search_paths") && (*params_j)["search_paths"].is_array()) {
        for (const auto & el : (*params_j)["search_paths"]) {
            if (el.is_string()) {
                candidates.push_back(el.get<std::string>());
            }
        }
    }
    for (const auto & path : candidates) {
        if (vfs_path_exists(path)) {
            return path;
        }
    }
    return {};
}

bool load_with_fallback(std::unique_ptr<capllama::llama_cap_context> & context, common_params cparams) {
#ifdef __EMSCRIPTEN__
    fprintf(stderr,
        "@@WASM_LOAD@@ phase=primary begin path=%s n_ctx=%d n_batch=%d n_threads=%d use_mmap=%d\n",
        cparams.model.path.c_str(), cparams.n_ctx, cparams.n_batch,
        cparams.cpuparams.n_threads, cparams.use_mmap ? 1 : 0);
#endif
    try {
        if (context->loadModel(cparams)) {
#ifdef __EMSCRIPTEN__
            fprintf(stderr, "@@WASM_LOAD@@ phase=primary ok\n");
#endif
            return true;
        }
#ifdef __EMSCRIPTEN__
        fprintf(stderr, "@@WASM_LOAD@@ phase=primary failed (loadModel returned false)\n");
#endif
    } catch (const std::exception & e) {
        fprintf(stderr, "loadModel exception: %s\n", e.what());
#ifdef __EMSCRIPTEN__
        fprintf(stderr, "@@WASM_LOAD@@ phase=primary failed (C++ exception — no fallback, WASM trap may follow)\n");
#endif
        return false;
    } catch (...) {
        fprintf(stderr, "loadModel unknown exception\n");
#ifdef __EMSCRIPTEN__
        fprintf(stderr, "@@WASM_LOAD@@ phase=primary failed (unknown exception — no fallback)\n");
#endif
        return false;
    }

#ifdef __EMSCRIPTEN__
    // Primary already uses effectiveNctx clamps (n_ctx<=512, n_batch<=8 for large async models).
    // A second loadModel() on the same context wastes heap and confuses stderr ordering.
    if (cparams.n_ctx <= 512 && cparams.n_batch <= 8) {
        fprintf(stderr,
            "@@WASM_LOAD@@ skip fallback: params already at WASM minimum (n_ctx=%d n_batch=%d use_mmap=%d)\n",
            cparams.n_ctx, cparams.n_batch, cparams.use_mmap ? 1 : 0);
        return false;
    }
#endif

    common_params minimal;
    minimal.model.path = cparams.model.path;
    minimal.n_batch = 128;
    minimal.n_gpu_layers = 0;
    minimal.use_mlock = false;
    minimal.numa = LM_GGML_NUMA_STRATEGY_DISABLED;
    minimal.ctx_shift = false;
    minimal.chat_template = cparams.chat_template;
    minimal.embedding = cparams.embedding;
    minimal.cont_batching = false;
    minimal.n_parallel = 1;
    minimal.antiprompt.clear();
    minimal.vocab_only = false;
    minimal.rope_scaling_type = LLAMA_ROPE_SCALING_TYPE_UNSPECIFIED;
    minimal.yarn_ext_factor = -1.0f;
    minimal.yarn_attn_factor = 1.0f;
    minimal.yarn_beta_fast = 32.0f;
    minimal.yarn_beta_slow = 1.0f;
    minimal.yarn_orig_ctx = 0;
    minimal.flash_attn = false;
    minimal.n_keep = 0;
    minimal.n_chunks = -1;
    minimal.n_sequences = 1;
    minimal.model_alias = "unknown";
#ifdef __EMSCRIPTEN__
    // Never fall back to use_mmap=false on WASM — copying a 700 MB GGUF OOMs.
    minimal.use_mmap = cparams.use_mmap;
    minimal.n_ctx = 64;
    minimal.n_batch = 32;
    fprintf(stderr,
        "@@WASM_LOAD@@ phase=fallback begin n_ctx=%d n_batch=%d use_mmap=%d\n",
        minimal.n_ctx, minimal.n_batch, minimal.use_mmap ? 1 : 0);
#else
    minimal.n_ctx = 256;
    minimal.use_mmap = false;
#endif
    const bool ok = context->loadModel(minimal);
#ifdef __EMSCRIPTEN__
    fprintf(stderr, "@@WASM_LOAD@@ phase=fallback %s\n", ok ? "ok" : "failed");
#endif
    return ok;
}

json default_chat_templates_json() {
    json caps = {
        {"tools", true},           {"toolCalls", true},     {"toolResponses", true},
        {"systemRole", true},      {"parallelToolCalls", true}, {"toolCallId", true},
    };
    json minja = {
        {"default", true},
        {"defaultCaps", caps},
        {"toolUse", true},
        {"toolUseCaps", caps},
    };
    return json::object({{"llamaChat", true}, {"minja", minja}});
}

void parse_completion_params(capllama::llama_cap_context * ctx, const char * params_json, std::string & prompt_out, int & n_predict_out) {
    std::string prompt_str = "Once upon a time";
    int n_predict = 50;
    double temperature = 0.7;
    int top_k = 40;
    double top_p = 0.95;
    float penalty_repeat = 1.1f;

    if (params_json && std::strlen(params_json) > 0) {
        try {
            json p = json::parse(params_json);
            if (p.contains("prompt") && p["prompt"].is_string()) {
                prompt_str = p["prompt"].get<std::string>();
            }
            if (p.contains("n_predict") && p["n_predict"].is_number_integer()) {
                n_predict = p["n_predict"].get<int>();
            }
            if (p.contains("max_tokens") && p["max_tokens"].is_number_integer()) {
                n_predict = p["max_tokens"].get<int>();
            }
            if (p.contains("temperature") && p["temperature"].is_number()) {
                temperature = p["temperature"].get<double>();
            }
            if (p.contains("top_k") && p["top_k"].is_number_integer()) {
                top_k = p["top_k"].get<int>();
            }
            if (p.contains("top_p") && p["top_p"].is_number()) {
                top_p = p["top_p"].get<double>();
            }
            if (p.contains("penalty_repeat") && p["penalty_repeat"].is_number()) {
                penalty_repeat = static_cast<float>(p["penalty_repeat"].get<double>());
            } else if (p.contains("repeat_penalty") && p["repeat_penalty"].is_number()) {
                penalty_repeat = static_cast<float>(p["repeat_penalty"].get<double>());
            }
        } catch (...) {
        }
    }

    ctx->params.sampling.temp = static_cast<float>(temperature);
    ctx->params.sampling.top_k = top_k;
    ctx->params.sampling.top_p = static_cast<float>(top_p);
    ctx->params.sampling.penalty_repeat = penalty_repeat;
    ctx->params.n_predict = n_predict;
    ctx->params.prompt = prompt_str;
    prompt_out = prompt_str;
    n_predict_out = n_predict;
}

void apply_completion_stops(capllama::llama_cap_context * ctx, const char * params_json) {
    ctx->params.antiprompt.clear();
    if (!params_json || !ctx) {
        return;
    }
    try {
        json p = json::parse(params_json);
        if (p.contains("stop") && p["stop"].is_array()) {
            for (const auto & el : p["stop"]) {
                if (el.is_string()) {
                    const std::string s = el.get<std::string>();
                    if (!s.empty()) {
                        ctx->params.antiprompt.push_back(s);
                    }
                }
            }
        }
    } catch (...) {
    }
}

bool ensure_completion(capllama::llama_cap_context * ctx) {
    if (!ctx || !ctx->ctx || !ctx->model) {
        return false;
    }
    if (!ctx->completion) {
        try {
            ctx->completion = new capllama::llama_cap_context_completion(ctx);
        } catch (...) {
            return false;
        }
    }
    return ctx->completion != nullptr;
}

/** Rewind, apply stops, re-init sampler (must run after every parse_completion_params). */
bool prepare_completion_run(capllama::llama_cap_context * ctx, const char * params_json) {
    if (!ensure_completion(ctx)) {
        return false;
    }
    ctx->completion->rewind();
    apply_completion_stops(ctx, params_json);
    if (!ctx->completion->initSampling() || !ctx->completion->ctx_sampling) {
        return false;
    }
    return true;
}

int run_completion_loop(
    capllama::llama_cap_context * ctx,
    int n_predict,
    bool & hit_eos_out,
    std::string & generated_text_out)
{
    generated_text_out.clear();
    hit_eos_out = false;
    if (!ctx || !ctx->completion || !ctx->model) {
        return 0;
    }

    const llama_vocab * vocab = llama_model_get_vocab(ctx->model);
    int tokens_generated = 0;

    ctx->completion->beginCompletion();

    while (tokens_generated < n_predict &&
           ctx->completion->has_next_token &&
           !ctx->completion->is_interrupted) {
        capllama::completion_token_output token_output = ctx->completion->doCompletion();
        if (token_output.tok < 0) {
            hit_eos_out = ctx->completion->stopped_eos;
#ifdef __EMSCRIPTEN__
            fprintf(stderr, "@@WASM_GEN@@ token_break tok=%d eos=%d n=%d\n",
                token_output.tok, hit_eos_out ? 1 : 0, tokens_generated);
#endif
            break;
        }
        if (llama_vocab_is_eog(vocab, token_output.tok)) {
            hit_eos_out = true;
#ifdef __EMSCRIPTEN__
            fprintf(stderr, "@@WASM_GEN@@ eos_at=%d\n", tokens_generated);
#endif
            break;
        }
        if (ctx->completion->stopped_word || ctx->completion->stopped_limit) {
            break;
        }
        tokens_generated++;
    }

    generated_text_out = ctx->completion->generated_text;
    ctx->completion->endCompletion();
    return tokens_generated;
}

} // namespace

extern "C" {

int64_t llama_init_context(const char * model_path, const char * params_json) {
    if (!model_path) {
        return -1;
    }
    try {
        json params_j;
        if (params_json && std::strlen(params_json) > 0) {
            try {
                params_j = json::parse(params_json);
            } catch (...) {
                params_j = json::object();
            }
        }

        std::string primary(model_path);
        const json * pj = params_j.is_object() ? &params_j : nullptr;
        std::string full_model_path = resolve_model_path(primary, pj);
        if (full_model_path.empty()) {
            fprintf(stderr, "llama_init_context: VFS path not found: %s\n", primary.c_str());
            return -1;
        }

        auto context = std::make_unique<capllama::llama_cap_context>();
        common_params cparams;
        cparams.model.path = full_model_path;
        cparams.n_ctx = 2048;
#ifdef __EMSCRIPTEN__
        cparams.n_batch = 128;
#else
        cparams.n_batch = 512;
#endif
        cparams.n_gpu_layers = 0;
        cparams.rope_freq_base = 10000.0f;
        cparams.rope_freq_scale = 1.0f;
        cparams.use_mmap = true;
        cparams.use_mlock = false;
        cparams.numa = LM_GGML_NUMA_STRATEGY_DISABLED;
        cparams.ctx_shift = false;
        cparams.chat_template = "";
        cparams.embedding = false;
        cparams.cont_batching = false;
        cparams.n_parallel = 1;
        cparams.antiprompt.clear();
        cparams.vocab_only = false;
        cparams.rope_scaling_type = LLAMA_ROPE_SCALING_TYPE_UNSPECIFIED;
        cparams.yarn_ext_factor = -1.0f;
        cparams.yarn_attn_factor = 1.0f;
        cparams.yarn_beta_fast = 32.0f;
        cparams.yarn_beta_slow = 1.0f;
        cparams.yarn_orig_ctx = 0;
        cparams.flash_attn = false;
        cparams.n_keep = 0;
        cparams.n_chunks = -1;
        cparams.n_sequences = 1;
        cparams.model_alias = "unknown";

        apply_params_json(cparams, pj);

#ifdef __EMSCRIPTEN__
        // Warmup runs llama_decode during load; skip on WASM to avoid post-init trap/OOM at 2GB heap.
        cparams.warmup = false;
        // Long chat templates exceed small n_ctx without shifting (LFM2 PWA loads n_ctx<=512).
        cparams.ctx_shift = true;
        // Non-pthread WASM: ggml-cpu lm_ggml_thread_create fails when n_threads > 1.
        cparams.cpuparams.n_threads = 1;
        cparams.cpuparams_batch.n_threads = 1;
        if (cparams.n_batch > 16) {
            cparams.n_batch = 16;
        }
        if (cparams.n_ctx > 512) {
            cparams.n_ctx = 512;
        }
#endif

        if (!load_with_fallback(context, cparams)) {
            fprintf(stderr,
                "llama_init_context: load failed for %s (n_ctx=%d n_batch=%d use_mmap=%d)\n",
                full_model_path.c_str(), cparams.n_ctx, cparams.n_batch, cparams.use_mmap ? 1 : 0);
            return -1;
        }

        int64_t id = g_next_id++;
        capllama::llama_cap_context * raw = nullptr;
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            g_contexts[id] = std::move(context);
            raw = g_contexts[id].get();
        }
        if (raw) {
            llama_embedding_register_context(id, raw);
        }
        return id;
    } catch (const std::exception & e) {
        fprintf(stderr, "llama_init_context exception: %s\n", e.what());
        return -1;
    } catch (...) {
        fprintf(stderr, "llama_init_context: unknown exception\n");
        return -1;
    }
}

void llama_release_context(int64_t context_id) {
    try {
        llama_embedding_unregister_context(context_id);
        std::lock_guard<std::mutex> lock(g_mutex);
        g_contexts.erase(context_id);
    } catch (...) {
    }
}

const char * llama_get_context_model_json(int64_t context_id) {
    std::lock_guard<std::mutex> lock(g_mutex);
    auto * ctx = get_ctx(context_id);
    if (!ctx || !ctx->model) {
        return tls_cstr("{}");
    }
    try {
        int64_t size = 0;
        if (!ctx->params.model.path.empty() && std::filesystem::exists(ctx->params.model.path)) {
            size = static_cast<int64_t>(std::filesystem::file_size(ctx->params.model.path));
        }
        json out = {
            {"path", ctx->params.model.path},
            {"desc", std::string("GGUF model")},
            {"size", size},
            {"nEmbd", llama_model_n_embd(ctx->model)},
            {"nParams", static_cast<int64_t>(llama_model_n_params(ctx->model))},
            {"chatTemplates", default_chat_templates_json()},
            {"metadata", json::object()},
        };
        return tls_cstr(out.dump());
    } catch (...) {
        return tls_cstr("{}");
    }
}

const char * llama_completion(int64_t context_id, const char * params_json) {
    try {
#ifdef __EMSCRIPTEN__
        fprintf(stderr, "@@WASM_GEN@@ begin ctx=%lld\n", (long long) context_id);
#endif
        std::lock_guard<std::mutex> lock(g_mutex);
        auto * ctx = get_ctx(context_id);
        if (!ctx || !ctx->ctx) {
            return tls_cstr("{\"error\":\"invalid context\"}");
        }

        std::string prompt_str;
        int n_predict = 50;
        parse_completion_params(ctx, params_json, prompt_str, n_predict);

        capllama::llama_cap_tokenize_result tokenize_result = ctx->tokenize(prompt_str, {});
        std::vector<llama_token> prompt_tokens = tokenize_result.tokens;

        if (!prepare_completion_run(ctx, params_json)) {
            return tls_cstr("{\"error\":\"completion prepare failed\"}");
        }

        std::string generated_text;
        int tokens_generated = 0;
        bool hit_eos = false;

        try {
            ctx->completion->loadPrompt({});
            if (ctx->completion->context_full) {
                return tls_cstr("{\"error\":\"prompt exceeds n_ctx — reload with larger n_ctx or shorten prompt\"}");
            }
#ifdef __EMSCRIPTEN__
            const auto t0 = std::chrono::steady_clock::now();
            fprintf(stderr, "@@WASM_GEN@@ prompt_ok tokens=%zu n_predict=%d n_past=%d\n",
                prompt_tokens.size(), n_predict, ctx->completion->n_past);
#endif
            tokens_generated = run_completion_loop(ctx, n_predict, hit_eos, generated_text);

#ifdef __EMSCRIPTEN__
            if (tokens_generated == 0 && !ctx->completion->context_full) {
                fprintf(stderr, "@@WASM_GEN@@ retry empty (eos=%d tok_break=%d)\n",
                    hit_eos ? 1 : 0, ctx->completion->stopped_word ? 1 : 0);
                llama_memory_clear(llama_get_memory(ctx->ctx), true);
                if (prepare_completion_run(ctx, params_json)) {
                    ctx->completion->loadPrompt({});
                    if (!ctx->completion->context_full) {
                        hit_eos = false;
                        tokens_generated = run_completion_loop(ctx, n_predict, hit_eos, generated_text);
                    }
                }
            }
            const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - t0).count();
            fprintf(stderr, "@@WASM_GEN@@ done predicted=%d ms=%lld\n",
                tokens_generated, (long long) ms);
#endif
        } catch (const std::exception & e) {
            try {
                if (ctx->completion) {
                    ctx->completion->endCompletion();
                }
            } catch (...) {
            }
            json err = {{"error", e.what()}};
            return tls_cstr(err.dump());
        }

        const bool stopped_limit = tokens_generated >= n_predict;
        const bool interrupted = ctx->completion && ctx->completion->is_interrupted;

        json timings = {
            {"prompt_n", static_cast<int>(prompt_tokens.size())},
            {"predicted_n", tokens_generated},
            {"prompt_ms", 0},
            {"predicted_ms", 0},
            {"prompt_per_token_ms", 0},
            {"predicted_per_token_ms", 0},
            {"prompt_per_second", 0},
            {"predicted_per_second", 0},
        };

        json tool_calls = json::array();
        json result = {
            {"text", generated_text},
            {"content", generated_text},
            {"reasoning_content", ""},
            {"tool_calls", tool_calls},
            {"tokens_predicted", tokens_generated},
            {"tokens_evaluated", static_cast<int>(prompt_tokens.size())},
            {"truncated", false},
            {"stopped_eos", hit_eos},
            {"stopped_word", ""},
            {"stopped_limit", stopped_limit},
            {"stopping_word", ""},
            {"context_full", false},
            {"interrupted", interrupted},
            {"chat_format", 0},
            {"tokens_cached", 0},
            {"timings", timings},
        };
        return tls_cstr(result.dump());
    } catch (const std::exception & e) {
        json err = {{"error", e.what()}};
        return tls_cstr(err.dump());
    } catch (...) {
        return tls_cstr("{\"error\":\"unknown\"}");
    }
}

void llama_stop_completion(int64_t context_id) {
    std::lock_guard<std::mutex> lock(g_mutex);
    auto * ctx = get_ctx(context_id);
    if (ctx && ctx->completion) {
        ctx->completion->is_interrupted = true;
    }
}

const char * llama_get_formatted_chat(int64_t context_id, const char * messages_json, const char * chat_template,
                                      const char * params_json) {
    (void)params_json;
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        auto * ctx = get_ctx(context_id);
        if (!ctx) {
            return tls_cstr("{\"error\":\"invalid context\"}");
        }
        std::string messages_str = messages_json ? messages_json : "";
        std::string template_str = chat_template ? chat_template : "";
        std::string prompt = ctx->getFormattedChat(messages_str, template_str);
        json out = {
            {"type", "llama-chat"},
            {"prompt", prompt},
            {"has_media", false},
            {"media_paths", json::array()},
        };
        return tls_cstr(out.dump());
    } catch (const std::exception & e) {
        json err = {{"error", e.what()}};
        return tls_cstr(err.dump());
    }
}

bool llama_toggle_native_log(bool enabled) {
    capllama_verbose = enabled;
    return true;
}

// ---------------------------------------------------------------------------
// WASM-specific: load context from an in-memory byte buffer (#1 / #9).
// On Emscripten the bytes are written to the VFS at /tmp/; on other builds
// (wasm32-unknown-unknown) the caller must ensure file-I/O is provided.
// ---------------------------------------------------------------------------
#ifdef CAPLLAMA_BUILD_WASM

#include "cap-wasm-jspi.h"
#include <errno.h>
#include <sys/stat.h>

extern "C" void cap_wasm_ensure_tmp_dir(void);

static std::string g_wasm_tmp_path;

static void ensure_wasm_tmp_dir() {
    cap_wasm_ensure_tmp_dir();
    if (mkdir("/tmp", 0777) != 0 && errno != EEXIST) {
    }
}

// Forward-declared to avoid duplicating all of llama_init_context's setup.
static int64_t init_context_with_cparams(common_params cparams);

int64_t llama_init_context_from_buffer(
    const uint8_t * data,
    size_t          size,
    const char *    params_json)
{
    if (!data || size == 0) {
        return -1;
    }

    // Choose a unique temporary path so concurrent loads don't clash.
    static int g_tmp_counter = 0;
    ensure_wasm_tmp_dir();
    std::string tmp_path = std::string("/tmp/wasm_model_") + std::to_string(g_tmp_counter++) + ".gguf";

    // Write bytes to the in-process virtual filesystem (Emscripten MEMFS or
    // a wasi-compatible /tmp/). If fopen fails here the target does not
    // support this path; callers should check the return value.
    FILE * f = fopen(tmp_path.c_str(), "wb");
    if (!f) {
        return -1;
    }
    size_t written = fwrite(data, 1, size, f);
    fclose(f);
    if (written != size) {
        remove(tmp_path.c_str());
        return -1;
    }

    int64_t id = llama_init_context(tmp_path.c_str(), params_json);
    remove(tmp_path.c_str());
    return id;
}

// ---------------------------------------------------------------------------
// Choice 3: stream model bytes from OPFS sync access handle into MEMFS.
// JS reads fixed-size chunks via FileSystemSyncAccessHandle and calls
// llama_model_vfs_write; llama_model_vfs_finish loads from the VFS path.
// Peak JS heap holds one chunk (~4MB), not the full GGUF.
// ---------------------------------------------------------------------------
static std::map<std::string, FILE *> g_model_vfs_writes;
static int g_vfs_stream_counter = 0;

const char * llama_model_vfs_begin() {
    ensure_wasm_tmp_dir();
    std::string path = std::string("/tmp/wasm_stream_") + std::to_string(g_vfs_stream_counter++) + ".gguf";
    FILE * f = fopen(path.c_str(), "wb");
    if (!f) {
        return nullptr;
    }
    g_model_vfs_writes[path] = f;
    return tls_cstr(path);
}

int llama_model_vfs_write(const char * path, const uint8_t * data, size_t len) {
    if (!path || !data || len == 0) {
        return -1;
    }
    auto it = g_model_vfs_writes.find(path);
    if (it == g_model_vfs_writes.end() || !it->second) {
        return -1;
    }
    return fwrite(data, 1, len, it->second) == len ? 0 : -1;
}

void llama_model_vfs_abort(const char * path) {
    if (!path) {
        return;
    }
    auto it = g_model_vfs_writes.find(path);
    if (it != g_model_vfs_writes.end()) {
        if (it->second) {
            fclose(it->second);
        }
        g_model_vfs_writes.erase(it);
    }
    remove(path);
}

int64_t llama_model_vfs_finish(const char * path, const char * params_json) {
    if (!path) {
        return -1;
    }
    auto it = g_model_vfs_writes.find(path);
    if (it != g_model_vfs_writes.end()) {
        if (it->second) {
            fclose(it->second);
        }
        g_model_vfs_writes.erase(it);
    }
    int64_t id = llama_init_context(path, params_json);
    remove(path);
    return id;
}

// Load from an existing VFS path (HeapFS / MEMFS file already populated).
int64_t llama_load_context_from_path(const char * path, const char * params_json) {
    if (!path) {
        return -1;
    }
    try {
        return llama_init_context(path, params_json);
    } catch (const std::exception & e) {
        fprintf(stderr, "llama_load_context_from_path exception: %s\n", e.what());
        return -1;
    } catch (...) {
        fprintf(stderr, "llama_load_context_from_path: unknown exception\n");
        return -1;
    }
}

// ---------------------------------------------------------------------------
// WASM-specific: streaming completion with per-token C callback (#2 / #3).
// Holds g_mutex for the full inference (same as llama_completion) so another
// thread cannot erase the context from g_contexts while streaming is active.
// ---------------------------------------------------------------------------
const char * llama_completion_stream(
    int64_t  context_id,
    const char * params_json,
    void (* token_callback)(const char * token_text, void * user_data, int token_index),
    void * user_data)
{
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        auto * ctx = get_ctx(context_id);
        if (!ctx || !ctx->ctx) {
            return tls_cstr("{\"error\":\"invalid context\"}");
        }

        std::string prompt_str;
        int n_predict = 50;
        parse_completion_params(ctx, params_json, prompt_str, n_predict);

        capllama::llama_cap_tokenize_result tokenize_result = ctx->tokenize(prompt_str, {});
        std::vector<llama_token> prompt_tokens = tokenize_result.tokens;

        if (!prepare_completion_run(ctx, params_json)) {
            return tls_cstr("{\"error\":\"completion prepare failed\"}");
        }

        std::string generated_text;
        int tokens_generated = 0;
        bool hit_eos = false;
        const llama_vocab * vocab = llama_model_get_vocab(ctx->model);

        try {
            ctx->completion->loadPrompt({});
            if (ctx->completion->context_full) {
                return tls_cstr("{\"error\":\"prompt exceeds n_ctx — reload with larger n_ctx or shorten prompt\"}");
            }
            ctx->completion->beginCompletion();

            while (tokens_generated < n_predict &&
                   ctx->completion->has_next_token &&
                   !ctx->completion->is_interrupted) {
                capllama::completion_token_output token_output = ctx->completion->doCompletion();
                if (token_output.tok < 0) {
                    hit_eos = ctx->completion->stopped_eos;
                    break;
                }
                if (llama_vocab_is_eog(vocab, token_output.tok)) {
                    hit_eos = true;
                    break;
                }
                if (ctx->completion->stopped_word || ctx->completion->stopped_limit) {
                    break;
                }
                std::string token_text = capllama::tokens_to_output_formatted_string(
                    ctx->ctx, token_output.tok);
                generated_text += token_text;

                if (token_callback) {
#if defined(CAPLLAMA_BUILD_WASM_JSPI) && defined(__EMSCRIPTEN__)
                    cap_wasm_jspi_token_callback(token_text.c_str(), user_data, tokens_generated);
#else
                    token_callback(token_text.c_str(), user_data, tokens_generated);
#endif
                }
                tokens_generated++;
            }
            generated_text = ctx->completion->generated_text;
            ctx->completion->endCompletion();
        } catch (const std::exception & e) {
            try {
                if (ctx->completion) ctx->completion->endCompletion();
            } catch (...) {}
            json err = {{"error", e.what()}};
            return tls_cstr(err.dump());
        }

        const bool stopped_limit  = tokens_generated >= n_predict;
        const bool interrupted    = ctx->completion && ctx->completion->is_interrupted;

        json timings = {
            {"prompt_n",                static_cast<int>(prompt_tokens.size())},
            {"predicted_n",             tokens_generated},
            {"prompt_ms",               0},
            {"predicted_ms",            0},
            {"prompt_per_token_ms",     0},
            {"predicted_per_token_ms",  0},
            {"prompt_per_second",       0},
            {"predicted_per_second",    0},
        };

        json result = {
            {"text",              generated_text},
            {"content",          generated_text},
            {"reasoning_content",""},
            {"tool_calls",       json::array()},
            {"tokens_predicted", tokens_generated},
            {"tokens_evaluated", static_cast<int>(prompt_tokens.size())},
            {"truncated",        false},
            {"stopped_eos",      hit_eos},
            {"stopped_word",     ""},
            {"stopped_limit",    stopped_limit},
            {"stopping_word",    ""},
            {"context_full",     false},
            {"interrupted",      interrupted},
            {"chat_format",      0},
            {"tokens_cached",    0},
            {"timings",          timings},
        };
        return tls_cstr(result.dump());
    } catch (const std::exception & e) {
        json err = {{"error", e.what()}};
        return tls_cstr(err.dump());
    } catch (...) {
        return tls_cstr("{\"error\":\"unknown\"}");
    }
}

#endif // CAPLLAMA_BUILD_WASM

const char * llama_model_info(const char * model_path, const char * skip_json) {
    (void)skip_json;
    if (!model_path || !std::strlen(model_path)) {
        return tls_cstr("{\"error\":\"invalid path\"}");
    }
    try {
        std::string p(model_path);
        if (!std::filesystem::exists(p)) {
            return tls_cstr("{\"error\":\"file not found\"}");
        }
        std::ifstream f(p, std::ios::binary);
        if (!f) {
            return tls_cstr("{\"error\":\"open failed\"}");
        }
        f.seekg(0, std::ios::end);
        auto sz = f.tellg();
        f.seekg(0, std::ios::beg);
        char magic[4];
        if (!f.read(magic, 4) || magic[0] != 'G' || magic[1] != 'G' || magic[2] != 'U' || magic[3] != 'F') {
            return tls_cstr("{\"error\":\"not GGUF\"}");
        }
        uint32_t version = 0;
        if (!f.read(reinterpret_cast<char *>(&version), sizeof(version))) {
            return tls_cstr("{\"error\":\"read version\"}");
        }
        json out = {
            {"path", p},
            {"size", static_cast<int64_t>(sz)},
            {"desc", std::string("GGUF Model (v") + std::to_string(version) + ")"},
            {"nEmbd", 0},
            {"nParams", 0},
        };
        return tls_cstr(out.dump());
    } catch (const std::exception & e) {
        json err = {{"error", e.what()}};
        return tls_cstr(err.dump());
    }
}

const char * llama_cap_tokenize(int64_t context_id, const char * text, const char * image_paths_json) {
    try {
        std::vector<std::string> media_paths;
        if (image_paths_json && std::strlen(image_paths_json) > 0) {
            try {
                json arr = json::parse(image_paths_json);
                if (arr.is_array()) {
                    for (const auto & el : arr) {
                        if (el.is_string()) {
                            media_paths.push_back(el.get<std::string>());
                        }
                    }
                }
            } catch (...) {
            }
        }
        std::lock_guard<std::mutex> lock(g_mutex);
        auto * ctx = get_ctx(context_id);
        if (!ctx || !ctx->ctx) {
            return tls_cstr("{\"error\":\"invalid context\"}");
        }
        std::string text_str = text ? text : "";
        capllama::llama_cap_tokenize_result tr = ctx->tokenize(text_str, media_paths);
        json tokens_j = json::array();
        for (llama_token t : tr.tokens) {
            tokens_j.push_back(static_cast<int>(t));
        }
        json bitmaps = json::array();
        for (const auto & h : tr.bitmap_hashes) {
            bitmaps.push_back(h);
        }
        json chunk_pos = json::array();
        for (auto v : tr.chunk_pos) {
            chunk_pos.push_back(v);
        }
        json chunk_pos_im = json::array();
        for (auto v : tr.chunk_pos_media) {
            chunk_pos_im.push_back(v);
        }
        json out = {
            {"tokens", tokens_j},
            {"has_images", tr.has_media},
            {"has_media", tr.has_media},
            {"bitmap_hashes", bitmaps},
            {"chunk_pos", chunk_pos},
            {"chunk_pos_images", chunk_pos_im},
        };
        return tls_cstr(out.dump());
    } catch (const std::exception & e) {
        json err = {{"error", e.what()}};
        return tls_cstr(err.dump());
    }
}

const char * llama_cap_detokenize(int64_t context_id, const char * tokens_json) {
    try {
        std::lock_guard<std::mutex> lock(g_mutex);
        auto * ctx = get_ctx(context_id);
        if (!ctx || !ctx->ctx) {
            return tls_cstr("");
        }
        std::vector<llama_token> llama_tokens;
        if (tokens_json && std::strlen(tokens_json) > 0) {
            json arr = json::parse(tokens_json);
            if (arr.is_array()) {
                for (const auto & el : arr) {
                    if (el.is_number_integer()) {
                        llama_tokens.push_back(static_cast<llama_token>(el.get<int>()));
                    }
                }
            }
        }
        std::string result = capllama::tokens_to_str(ctx->ctx, llama_tokens.begin(), llama_tokens.end());
        return tls_cstr(result);
    } catch (...) {
        return tls_cstr("");
    }
}

const char * llama_convert_json_schema_to_grammar(const char * schema_json) {
    if (!schema_json || !std::strlen(schema_json)) {
        return tls_cstr("");
    }
    try {
        json schema = json::parse(schema_json);
        std::string g = json_schema_to_grammar(schema, false);
        return tls_cstr(g);
    } catch (const std::exception & e) {
        return tls_cstr("");
    }
}

} // extern "C"