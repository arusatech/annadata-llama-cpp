// JSPI async GGUF file read — intercepts libc fread when async mode is enabled.
// Model bytes stay in JS (Blob / OPFS reader); WASM reads on demand in 1 MB chunks.
// Ref: ref-code/wllama (wllama-fs.h)

#if defined(CAPLLAMA_BUILD_WASM_JSPI) && defined(__EMSCRIPTEN__)

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
#include <vector>

#include <emscripten.h>

static std::map<FILE *, std::string> s_file_path_map;

namespace cap_wasm_fs {

// Set from JS via cap_wasm_set_use_async_file() — do not cache getenv once at startup
// (getenv may run before Module.ENV is applied, locking async off permanently).
static bool use_async_explicit = false;

static const size_t CACHE_SIZE = 1024 * 1024; // 1 MB read-ahead

std::vector<uint8_t> cache_data;
size_t             cache_start = 0;
FILE *             cache_file  = nullptr;

bool use_async_file() {
    if (use_async_explicit) {
        return true;
    }
    return getenv("USE_ASYNC_FILE") != nullptr;
}

void set_use_async_file(bool enabled) {
    use_async_explicit = enabled;
}

size_t try_cache(FILE *f, char *ptr, size_t req_bytes, size_t fpos) {
    if (f != cache_file || cache_data.empty()) {
        return 0;
    }
    if (fpos >= cache_start && fpos + req_bytes <= cache_start + cache_data.size()) {
        memcpy(ptr, cache_data.data() + (fpos - cache_start), req_bytes);
        return req_bytes;
    }
    return 0;
}

} // namespace cap_wasm_fs

// Implemented in llama_engine.js shim (_cap_js_file_read) — sync EM_JS (no JSPI suspend).
EM_JS(size_t, cap_js_file_read_impl, (const char *path_ptr, size_t offset, size_t req_size, void *out_ptr), {
  return Number(_cap_js_file_read(UTF8ToString(Number(path_ptr)), Number(offset), Number(req_size), Number(out_ptr)));
});

extern "C" {

void cap_wasm_set_use_async_file(int enabled) {
    cap_wasm_fs::set_use_async_file(enabled != 0);
}

FILE *__real_fopen(const char *path, const char *mode);
int   __real_fclose(FILE *f);
size_t __real_fread(void *ptr, size_t size, size_t nmemb, FILE *f);
int   __real_fseek(FILE *f, long offset, int whence);
long  __real_ftell(FILE *f);

FILE *__wrap_fopen(const char *path, const char *mode) {
    FILE *f = __real_fopen(path, mode);
    if (f) {
        s_file_path_map[f] = path;
    }
    return f;
}

int __wrap_fclose(FILE *f) {
    if (cap_wasm_fs::cache_file == f) {
        cap_wasm_fs::cache_file = nullptr;
        cap_wasm_fs::cache_data.clear();
    }
    s_file_path_map.erase(f);
    return __real_fclose(f);
}

int __wrap_fseek(FILE *f, long offset, int whence) {
    return __real_fseek(f, offset, whence);
}

long __wrap_ftell(FILE *f) {
    return __real_ftell(f);
}

size_t __wrap_fread(void *ptr, size_t size, size_t nmemb, FILE *f) {
    if (!cap_wasm_fs::use_async_file()) {
        return __real_fread(ptr, size, nmemb, f);
    }

    auto nit = s_file_path_map.find(f);
    if (nit == s_file_path_map.end()) {
        return __real_fread(ptr, size, nmemb, f);
    }

    size_t req_bytes = size * nmemb;
    if (req_bytes == 0) {
        return 0;
    }

    size_t fpos = static_cast<size_t>(__real_ftell(f));

    // Large reads (>= 1 MB): write directly into ptr, skip cache entirely.
    if (req_bytes >= cap_wasm_fs::CACHE_SIZE) {
        size_t actual = static_cast<size_t>(cap_js_file_read_impl(
            nit->second.c_str(), fpos, req_bytes, ptr));
        if (actual == 0) {
            return 0;
        }
        size_t copy_bytes = std::min(req_bytes, actual);
        __real_fseek(f, static_cast<long>(fpos + copy_bytes), SEEK_SET);
        return copy_bytes / size;
    }

    // Small reads: try cache first.
    size_t cached = cap_wasm_fs::try_cache(f, static_cast<char *>(ptr), req_bytes, fpos);
    if (cached == req_bytes) {
        __real_fseek(f, static_cast<long>(fpos + req_bytes), SEEK_SET);
        return nmemb;
    }

    // Cache miss: fetch a full CACHE_SIZE block from JS.
    cap_wasm_fs::cache_data.resize(cap_wasm_fs::CACHE_SIZE);
    size_t actual = static_cast<size_t>(cap_js_file_read_impl(
        nit->second.c_str(), fpos, cap_wasm_fs::CACHE_SIZE,
        cap_wasm_fs::cache_data.data()));

    cap_wasm_fs::cache_data.resize(actual);
    cap_wasm_fs::cache_file  = f;
    cap_wasm_fs::cache_start = fpos;

    if (actual == 0) {
        return 0;
    }

    size_t copy_bytes = std::min(req_bytes, actual);
    memcpy(ptr, cap_wasm_fs::cache_data.data(), copy_bytes);
    __real_fseek(f, static_cast<long>(fpos + copy_bytes), SEEK_SET);

    return copy_bytes / size;
}

} // extern "C"

#endif // CAPLLAMA_BUILD_WASM_JSPI && __EMSCRIPTEN__
