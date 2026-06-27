#if defined(CAPLLAMA_BUILD_WASM) && defined(__EMSCRIPTEN__)

#include <emscripten.h>

// Must live outside cap-ios-bridge.cpp's extern "C" block (emscripten.h uses C++ templates).
extern "C" void cap_wasm_ensure_tmp_dir(void) {
    EM_ASM({
        if (typeof FS !== 'undefined') {
            try {
                if (!FS.analyzePath('/tmp').exists) {
                    if (typeof FS.createPath === 'function') {
                        FS.createPath('/', 'tmp', true, true);
                    } else {
                        FS.mkdir('/tmp');
                    }
                }
            } catch (e) {}
        }
    });
}

#endif
