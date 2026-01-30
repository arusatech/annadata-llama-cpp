# iOS Implementation Guide

This guide explains **how the iOS side of the plugin works** and gives **step-by-step instructions** for implementing or updating methods on iOS, including **updating the native llama.cpp layer** (e.g. for vision model support) using the bootstrap script.

---

## 1. iOS architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  JavaScript (Capacitor app)                                      │
│  LlamaCpp.initContext({ ... }), context.completion({ ... })      │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Capacitor bridge
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LlamaCppPlugin.swift (Capacitor plugin)                        │
│  - Declares plugin methods (CAPPluginMethod)                     │
│  - Reads args from CAPPluginCall, calls implementation           │
│  - Resolves/rejects with JSObject                                │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  LlamaCpp.swift (implementation)                                │
│  - Holds contexts, loads native framework via dlsym              │
│  - Calls C function pointers (initContext, completion, etc.)   │
└───────────────────────────────┬─────────────────────────────────┘
                                │ dlsym → C symbols
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  llama-cpp.framework (native C/C++)                              │
│  - Built from cpp/ (cap-llama.cpp, cap-completion.cpp, etc.)     │
│  - Exposes C API used by Swift (e.g. llama_init_context)        │
└─────────────────────────────────────────────────────────────────┘
```

- **LlamaCppPlugin.swift**: Thin bridge; every API is a `@PluginMethod` that forwards to `LlamaCpp`.
- **LlamaCpp.swift**: Loads `llama-cpp.framework`, resolves C symbols with `dlsym`, keeps context map, implements init/completion/embedding/etc.
- **Native layer**: Built from `cpp/` by CMake into `ios/build/llama-cpp.framework`, then copied to `ios/Frameworks/`. The C entry points called from Swift must be exported from this framework.

---

## 2. Step-by-step: implementing a method on the iOS side

To add or change a **single method** end-to-end on iOS:

### Step 1: Ensure the C API exists in the native layer

The Swift code calls into the framework via **C function pointers** (see `LlamaCpp.swift`: `loadFunctionPointers()`, `initContextFunc`, `completionFunc`, etc.). So the native (C/C++) code must expose a C symbol.

- **If the symbol already exists** (e.g. `llama_init_context`): skip to Step 2.
- **If you need a new C entry point** (e.g. for vision):
  1. Add or update the C/C++ implementation in `cpp/` (e.g. in `cap-llama.cpp` or a new `cap-vision.cpp`).
  2. Declare a C-compatible function in a header or in a `.cpp` with `extern "C"` and ensure it’s linked into the iOS framework (it’s part of the CMake target in `ios/CMakeLists.txt`).
  3. Rebuild the framework (Step 5 below) and optionally verify with `nm ios/Frameworks/llama-cpp.framework/llama-cpp | grep your_symbol`.

### Step 2: Load the symbol in Swift (LlamaCpp.swift)

1. Add a **function pointer variable** (e.g. `private var myNewFunc: ((Int64, String) -> String?)?`).
2. In `loadFunctionPointers()`, add:
   - `myNewFunc = unsafeBitCast(dlsym(library, "my_new_func"), to: ((Int64, String) -> String?).self)`
3. In the implementation method that uses it, **guard** on `myNewFunc != nil` and call it.

### Step 3: Implement the Swift method (LlamaCpp.swift)

1. Add a method on `LlamaCpp`, e.g. `func myNewFeature(contextId: Int, input: String, completion: @escaping (LlamaResult<...>) -> Void)`.
2. Look up context, optionally call `loadFunctionPointers()`, call the native function pointer, convert result to a dictionary/type that matches the plugin API, and call `completion(.success(...))` or `completion(.failure(...))`.

### Step 4: Expose the method in the plugin (LlamaCppPlugin.swift)

1. In `pluginMethods`, add:
   - `CAPPluginMethod(name: "myNewFeature", returnType: CAPPluginReturnPromise)`.
2. Add an `@objc func myNewFeature(_ call: CAPPluginCall)` that:
   - Reads arguments from `call` (e.g. `call.getInt("contextId")`, `call.getString("input")`).
   - Calls `implementation.myNewFeature(...) { result in ... }`.
   - On success: `call.resolve(...)`; on failure: `call.reject(...)`.

### Step 5: Rebuild the iOS framework

From the project root:

```bash
# Option A: build script (recommended)
./build-native.sh

# Option B: iOS only
cd ios/build && cmake .. -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 && cmake --build . --config Release
```

Then copy the built framework to `ios/Frameworks/` if your script doesn’t do it (the root `build-native.sh` does).

### Step 6: TypeScript/definitions (if adding a new API)

If this is a **new** plugin method, add the corresponding method to `src/definitions.ts` and implement or stub it in `src/index.ts` and `src/web.ts` so the JS API is consistent across platforms.

---

## 3. Updating the native llama.cpp layer (e.g. for vision)

The **native source** under `cpp/` is based on [ggerganov/llama.cpp](https://github.com/ggerganov/llama.cpp). To pull in a newer version (e.g. with vision model support) **without losing the Capacitor adapter code**, use the **bootstrap script**.

### 3.1 What the bootstrap script does

- **Clones** upstream `llama.cpp` (default: `master`; you can pass a branch, tag, or commit).
- **Syncs** upstream files into `cpp/`, **excluding** project-specific files so they are not overwritten.

**Never overwritten:**

- `cap-llama.cpp` / `cap-llama.h`
- `cap-completion.cpp` / `cap-completion.h`
- `cap-tts.cpp` / `cap-tts.h`
- `cap-embedding.cpp` / `cap-embedding.h`
- `cap-mtmd.hpp`
- `cpp/README.md`
- `cpp/tools/mtmd/` (multimodal/vision tooling)

Everything else in `cpp/` (ggml, llama, common, chat, etc.) is updated from upstream.

### 3.2 Step-by-step: update native source and add vision support

1. **Run the bootstrap script** (from repo root):

   ```bash
   ./scripts/bootstrap.sh [REF]
   ```

   - `REF` optional: branch, tag, or commit (default: `master`).
   - Example: `./scripts/bootstrap.sh master`
   - Example: `./scripts/bootstrap.sh b5234` (specific commit)

2. **Resolve conflicts**  
   If you had local changes in non–project-specific files, fix any merge/conflict markers left in `cpp/`.

3. **Reconcile adapter code with upstream**  
   Upstream APIs (function names, structs, init flags) sometimes change. You may need to update:
   - `cap-llama.cpp` / `cap-llama.h` (context init, model load)
   - `cap-completion.cpp` (completion loop)
   - `cap-tts.cpp` if TTS API changed
   - `cap-embedding.cpp` if embedding API changed
   - `cap-mtmd.hpp` and `cpp/tools/mtmd/` for **vision/multimodal**: align with any new llama.cpp multimodal/vision APIs (e.g. clip, llava, or new projector types).

4. **Rebuild native libraries**

   ```bash
   npm run build:native
   # or
   ./build-native.sh
   ```

5. **Verify iOS**  
   Open the app in Xcode, run on device/simulator, and test init, completion, and (if applicable) vision/multimodal flows.

### 3.3 Vision model: current state and what to do

- **Current state**: The plugin’s native layer may not support the latest vision models (e.g. newer LLaVA or other vision architectures) until the native code is updated.
- **How to get vision support**:
  1. Run `./scripts/bootstrap.sh` with a ref that includes the vision changes you need (e.g. `master` or a specific tag).
  2. Keep `cap-*.cpp/h` and `cpp/tools/mtmd/`; update them to use the new upstream APIs (e.g. new init flags, new clip/vision entry points).
  3. If Swift currently calls a C symbol that was renamed or removed, update `LlamaCpp.swift` (function pointer name and/or signature) and repeat the “implement a method” steps above.
  4. Rebuild with `./build-native.sh` and test on device.

---

## 4. File reference

| Layer        | File(s)                | Role |
|-------------|------------------------|------|
| Plugin      | `ios/Sources/LlamaCppPlugin/LlamaCppPlugin.swift` | Capacitor plugin; declares methods, forwards to `LlamaCpp`. |
| Implementation | `ios/Sources/LlamaCppPlugin/LlamaCpp.swift`   | Loads framework, dlsym C symbols, implements logic. |
| Native      | `cpp/cap-llama.cpp`, `cap-completion.cpp`, `cap-tts.cpp`, … | C++ bridge used by iOS/Android builds. |
| Build       | `ios/CMakeLists.txt`, `build-native.sh`      | Builds `llama-cpp.framework` from `cpp/`. |
| Bootstrap   | `scripts/bootstrap.sh`                      | Syncs upstream llama.cpp into `cpp/` while keeping adapter code. |

---

## 5. Quick checklist: “I’m updating llama.cpp for vision”

1. Run `./scripts/bootstrap.sh [ref]`.
2. Manually update `cap-*.cpp` / `cap-mtmd.hpp` / `tools/mtmd/` to match new upstream APIs.
3. Rebuild: `./build-native.sh`.
4. If you added/renamed C symbols used by iOS, update `LlamaCpp.swift` (function pointers and implementation).
5. If you added new plugin APIs, update `LlamaCppPlugin.swift`, `definitions.ts`, `index.ts`, and `web.ts`.
6. Test on iOS device/simulator.

For more detail on the native layer and what’s project-specific, see `cpp/README.md`.
