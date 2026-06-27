#if defined(CAPLLAMA_BUILD_WASM_JSPI) && defined(__EMSCRIPTEN__)

#include "cap-wasm-jspi.h"
#include <emscripten/emscripten.h>

// Dispatches each generated token to Module.__llamaStreamOnToken (set by wasm.engine.ts).
EM_ASYNC_JS(void, cap_js_token_dispatch_impl, (const char *token_ptr, int index), {
  if (Module.__llamaStreamOnToken) {
    await Module.__llamaStreamOnToken(UTF8ToString(Number(token_ptr)), Number(index));
  }
});

extern "C" void cap_wasm_jspi_token_dispatch(const char *token_text, int token_index) {
    if (token_text) {
        cap_js_token_dispatch_impl(token_text, token_index);
    }
}

#endif
