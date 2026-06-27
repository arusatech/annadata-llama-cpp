#pragma once

// JSPI token streaming for Emscripten WASM builds.
// Implementation lives in cap-wasm-jspi.cpp (EM_ASYNC_JS must not be in a
// header included from other translation units — causes em_asm.h conflicts).

#if defined(CAPLLAMA_BUILD_WASM_JSPI) && defined(__EMSCRIPTEN__)

#ifdef __cplusplus
extern "C" {
#endif

void cap_wasm_jspi_token_dispatch(const char *token_text, int token_index);

#ifdef __cplusplus
}

inline void cap_wasm_jspi_token_callback(
    const char *token_text,
    void * /*user_data*/,
    int token_index)
{
    if (token_text && token_text[0] != '\0') {
        cap_wasm_jspi_token_dispatch(token_text, token_index);
    }
}

#endif // __cplusplus

#endif // CAPLLAMA_BUILD_WASM_JSPI && __EMSCRIPTEN__
