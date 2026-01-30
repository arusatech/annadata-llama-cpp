# Line-by-Line Code Analysis: iOS, Android, PWA & Build Packages

This document provides a structured analysis of the **llama-cpp-capacitor** project: iOS and Android native implementations, web/PWA behavior, and build configuration.

---

## 1. Project Overview

- **Type**: Capacitor native plugin (npm package `llama-cpp-capacitor`).
- **Purpose**: Embeds llama.cpp in mobile apps for offline AI (chat, completion, embeddings, multimodal, TTS, LoRA).
- **Platforms**: iOS (Swift + native framework), Android (Java + JNI/C++), Web (stub only).

---

## 2. iOS Implementation

### 2.1 `ios/Sources/LlamaCppPlugin/LlamaCppPlugin.swift`

| Lines | Purpose |
|-------|---------|
| 1–7 | Imports Foundation + Capacitor; references Capacitor iOS plugin guide. |
| 8–9 | `@objc(LlamaCppPlugin)` — exposes to Objective-C runtime; class extends `CAPPlugin`, `CAPBridgedPlugin`. |
| 9–10 | `identifier`, `jsName` — plugin id `LlamaCppPlugin`, JS name `LlamaCpp`. |
| 11–75 | `pluginMethods` — array of `CAPPluginMethod` for every API (initContext, completion, chat, embedding, TTS, download, grammar, events, etc.). |
| 76 | `private let implementation = LlamaCpp()` — single instance of native logic. |
| 79–418 | **Core / chat / session / tokenization / embedding / bench / LoRA / multimodal / TTS / events** — each `@objc func` reads args from `CAPPluginCall` (e.g. `call.getInt("contextId")`, `call.getObject("params")`), calls `implementation.*`, then `call.resolve(...)` or `call.reject(...)`. |
| 414–423 | **Events** — `addListener` / `removeAllListeners` resolve immediately; comment notes Capacitor events are handled differently (placeholder). |
| 425–451 | **Model download / management** — `downloadModel`, `getDownloadProgress`, `cancelDownload`, `getAvailableModels` forward to implementation. |
| 453–464 | **Grammar** — `convertJsonSchemaToGrammar` forwards to implementation. |

**Summary**: Plugin class is a thin bridge: Capacitor call → `LlamaCpp` implementation → resolve/reject.

---

### 2.2 `ios/Sources/LlamaCppPlugin/LlamaCpp.swift`

| Lines | Purpose |
|-------|---------|
| 1–6 | Imports; global `contexts: [Int64: UnsafeMutableRawPointer]`, `nextContextId`. |
| 8–21 | **LibraryLoader** — loads `llama-cpp.framework` via `Bundle.main.path(forResource:ofType:)` and `dlopen(..., RTLD_NOW)`. |
| 24–32 | Function pointers for native C: `initContextFunc`, `releaseContextFunc`, `completionFunc`, `stopCompletionFunc`, `getFormattedChatFunc`, `toggleNativeLogFunc`, `embeddingFunc`, `registerEmbeddingContextFunc`, `unregisterEmbeddingContextFunc`. |
| 34–46 | `loadFunctionPointers()` — `dlsym` + `unsafeBitCast` for each symbol from the framework. |
| 49–73 | **LlamaError** enum and **LlamaResult<T>** typealias for Swift Result. |
| 75–147 | **LlamaContext**, **LlamaModel**, **ChatTemplates**, **MinjaTemplates**, **MinjaCaps** — in-memory model/context and chat-template structures. |
| 150–166 | **LlamaCpp** class: `contexts`, `contextCounter`, `contextLimit`, `nativeLogEnabled`. |
| 158–314 | **initContext** — checks limit, reads `params["model"]`, creates Swift context + model, serializes params to JSON, calls `loadFunctionPointers()`, then native `initContextFunc(modelPath, paramsJson)`. Stores context by id; optionally `registerEmbeddingContextFunc`. Returns context info dict (gpu, model desc, chatTemplates, etc.). |
| 316–341 | **releaseContext** / **releaseAllContexts** — unregister embedding if present, call native release, remove from `contexts`. |
| 349–393 | **getFormattedChat** / **completion** / **stopCompletion** — context lookup; completion returns a fixed sample structure; stopCompletion no-op. |
| 395–447 | **chat** — converts messages to JSON, prepends system message, calls `getFormattedChat` then `completion`. **chatWithSystem** / **generateText** — thin wrappers. |
| 449–583 | **Session, tokenize, detokenize** — placeholders (empty/zero). |
| 385–428 | **embedding** — loads function pointers; requires `embeddingFunc` and model `nEmbd`; calls native `embeddingFunction(contextId, text, paramsCString)`, copies `UnsafePointer<Float>` to Swift array, returns `embedding` + `n_embd`. |
| 430–447 | **rerank** — returns empty list. |
| 449–583 | **bench**, **LoRA**, **multimodal**, **TTS** — mostly flags on context (e.g. `isMultimodalEnabled`, `isVocoderEnabled`) or placeholder return values. |
| 525–583 | **downloadModel** — `FileManager`, documents dir, `Data(contentsOf: downloadURL)` on background queue, write to file, callback. **getDownloadProgress** / **cancelDownload** — placeholders. **getAvailableModels** — scans documents/downloads for `.gguf`/`.ggml`/`.bin`. |
| 585–591 | **convertJsonSchemaToGrammar** — returns schema as-is. |

**Summary**: iOS uses dynamic loading of `llama-cpp.framework` and a small set of C function pointers. Real inference depends on the native framework exposing symbols like `llama_init_context`, `llama_completion`, `llama_embedding`, etc. Many methods (session, LoRA, multimodal, TTS) are state/placeholders.

---

## 3. Android Implementation

### 3.1 `android/src/main/java/ai/annadata/plugin/capacitor/LlamaCppPlugin.java`

| Lines | Purpose |
|-------|---------|
| 1–19 | Imports (Log, Capacitor Plugin/Call/JSObject/JSArray, annotation, Context, File, List, Map). |
| 20–32 | `@CapacitorPlugin(name = "LlamaCpp")`, extends `Plugin`; in `load()` creates `implementation = new LlamaCpp(getContext())`. |
| 36–464 | **PluginMethod** methods: read args from `PluginCall` (e.g. `call.getInt("contextId", 0)`, `call.getObject("params")`), call `implementation.*(..., result -> { call.resolve(jsResult) or call.reject(...) })`. |
| 77–86, 98–106, etc. | Success path: `result.getData()` → `convertMapToJSObject` or `convertListToJSArray` → `call.resolve(jsResult)`. |
| 453–458 | **downloadModel** resolves with `ret.put("localPath", result.getData())` — host app may expect `path`; worth aligning with TS definitions. |
| 466–478 | **convertJsonSchemaToGrammar** — forwards schema string to implementation. |
| 482–528 | **convertMapToJSObject** / **convertListToJSArray** — recursive conversion Map/List → JSObject/JSArray for Capacitor. |

**Summary**: Android plugin is a thin Capacitor → Java bridge; all logic lives in `LlamaCpp` and JNI.

---

### 3.2 `android/src/main/java/ai/annadata/plugin/capacitor/LlamaCpp.java`

| Lines | Purpose |
|-------|---------|
| 19–55 | **LlamaResult<T>**, **LlamaError** — result/error wrapper. |
| 57–239 | **LlamaContext**, **LlamaModel**, **ChatTemplates**, **MinjaTemplates**, **MinjaCaps** — same conceptual model as iOS (context id, model, multimodal/vocoder flags, nativeContextId). |
| 242–251 | **LlamaCpp** — `contexts`, `contextCounter`, `contextLimit`, `nativeLogEnabled`, `Context context`; constructor takes `Context`. |
| 254–274 | **Native declarations** — `private native long initContextNative(...)`, `releaseContextNative`, `completionNative`, `modelInfoNative`, `stopCompletionNative`, `getFormattedChatNative`, `toggleNativeLogNative`, `tokenizeNative`, `detokenizeNative`, `embeddingNative`, `downloadModelNative`, `getDownloadProgressNative`, `cancelDownloadNative`, `getAvailableModelsNative`, `convertJsonSchemaToGrammarNative`. |
| 276–311 | **static { }** — `System.getProperty("os.arch")`, `Build.SUPPORTED_ABIS[0]`; map ABI to library name (`llama-cpp-arm64`, `-armeabi`, `-x86`, `-x86_64`), `System.loadLibrary(libraryName)`. |
| 314–383 | **toggleNativeLog**, **setContextLimit**; **downloadModel** starts background thread for `downloadFile`, but also calls `callback.onResult(LlamaResult.success(localPath))` immediately (bug: callback invoked twice). **getDownloadProgress** / **cancelDownload** / **getAvailableModels** / **convertJsonSchemaToGrammar** — delegate to native. |
| 385–408 | **modelInfo** — native `modelInfoNative(path)`; fallback map if null; on exception still returns an “error” info map. |
| 410–438 | **initContext** — limit check; get `modelPath` from params; `getModelSearchPaths(filename)`; `initContextNative(modelPath, searchPaths, params)`; store context with `nativeContextId`; return context info (gpu, model, androidLib). |
| 440–461 | **releaseContext** / **releaseAllContexts** — native release and remove from map. |
| 463–523 | **getFormattedChat**, **completion**, **stopCompletion** — context lookup, call native with `context.getNativeContextId()`. |
| 425–458 | **chat** — parse messages JSON, prepend system, `getFormattedChatNative` then `completionNative`. **chatWithSystem** / **generateText** — build params and call completion. |
| 520–535 | **parseMessagesJson** / **convertMessagesToJson** — JSONArray ↔ List<Map>. |
| 537–608 | **Session, tokenize, detokenize** — context check; tokenize/detokenize call native; detokenize converts `Integer[]` to `int[]`. |
| 610–633 | **embedding** — native `embeddingNative(contextId, text, params)`; validate result has `"embedding"`. |
| 535–558 | **rerank** — mock: random scores per document. |
| 560–583 | **bench** — placeholder. |
| 585–624 | **LoRA** — placeholders (resolve success, no native). |
| 626–662 | **Multimodal** — set/read `context.isMultimodalEnabled()`, support map `vision/audio: true`. |
| 664–702 | **TTS/Vocoder** — set/read `isVocoderEnabled()`; audio methods return empty/placeholder. |
| 704–708 | **LlamaCallback<T>** interface. |
| 710–738 | **getModelSearchPaths** — internal files dir, external files dir, external storage Documents/Download/Downloads/models; returns paths for given filename. |

**Summary**: Android uses JNI for real work (init, completion, tokenize, embedding, model info, etc.). Session, LoRA, multimodal, TTS are mostly Java-side flags/placeholders. Download has a logic bug (double callback).

---

### 3.3 `android/src/main/jni.cpp` (JNI layer)

| Lines | Purpose |
|-------|---------|
| 1–13 | Includes (jni-utils, cap-llama, cap-completion), Android log, string, memory, fstream, signal, thread, atomic, filesystem, mutex. |
| 24–126 | **jni_utils** — `jstring_to_string`, `string_to_jstring`, array/vector conversions, primitive conversions, `throw_java_exception`, `check_exception`, field/method/class helpers. |
| 148–149 | Global `contexts` map (jlong → `std::unique_ptr<capllama::llama_cap_context>`), `next_context_id`. |
| 156–406 | **initContextNative** — jstring/jarray to C++ strings; build path list; find first existing path; optional GGUF version check; create `llama_cap_context`, fill `common_params` (model path, n_ctx, n_batch, n_gpu_layers, embedding, use_mmap, etc.); read from JSObject (embedding, n_ctx, n_batch, n_gpu_layers, use_mmap, use_mlock); install SIGSEGV handler; `context->loadModel(cparams)`; on failure retry with minimal params; store context, return jlong id. |
| 408–422 | **releaseContextNative** — erase from `contexts`. |
| 424–608 | **completionNative** — get context; read prompt, n_predict, temperature from JSObject; set sampling params; tokenize prompt; create/lazy-init `ctx->completion` (llama_cap_context_completion), initSampling, rewind, loadPrompt, beginCompletion; loop nextToken until n_predict or EOS; build HashMap result (text, content, reasoning_content, tool_calls, tokens_predicted/evaluated, flags, timings). |
| 610–624 | **stopCompletionNative** — lookup and log (actual stop logic can be extended). |
| 626–652 | **getFormattedChatNative** — context->getFormattedChat(messages, template), return jstring. |
| 654–666 | **toggleNativeLogNative** — log and return true. |
| 668–738 | **modelInfoNative** — path list (incl. hardcoded app paths); find existing file; size and GGUF magic/version read; return HashMap (path, size, desc, nEmbd, nParams). |
| 742–768 | **downloadModelNative** — return path under `/storage/emulated/0/Android/data/ai.annadata.llamacpp/files/Models/`; create_directories. |
| 770–810 | **getDownloadProgressNative** / **cancelDownloadNative** — placeholder (progress 0, completed false; cancel false). |
| 812–861 | **getAvailableModelsNative** — scan same Models dir for `.gguf`, return ArrayList of name/path/size. |
| 865–934 | **tokenizeNative** — context->tokenize(text, {}), build HashMap with tokens ArrayList and empty has_images, bitmap_hashes, chunk_pos. |
| 936–984 | **detokenizeNative** — jintArray to vector, `tokens_to_str`, return jstring. |
| 988–1129 | **embeddingNative** — context lookup; n_embd from model; optional embedding warning if not init with embedding; read embd_normalize from params; tokenize; llama_set_embeddings(true); batch decode; mean-pool or last-token embedding; optional normalize; return HashMap with "embedding" ArrayList and "n_embd". |
| 1131–1133 | **convertJsonSchemaToGrammarNative** — not implemented in shown snippet; declared in Java. |

**Summary**: JNI implements real init, completion, formatted chat, model info, tokenize, detokenize, embedding, and file/model listing. Download/prepare path is in native code; actual download and progress are intended to be in Java (with current double-callback issue).

---

## 4. PWA / Web Implementation

### 4.1 `src/web.ts`

| Lines | Purpose |
|-------|---------|
| 1–4 | Imports `registerPlugin`, `LlamaCppPlugin` type. |
| 4–149 | **LlamaCppWeb** implements **LlamaCppPlugin**: every method either `console.warn('... not supported on web platform')` or `throw new Error('... not supported on web platform. Use native platforms (iOS/Android)...')`. No inference, no backend call. |
| 145–148 | `registerPlugin<LlamaCppPlugin>('LlamaCpp', { web: () => import('./web').then(m => new m.LlamaCppWeb()) })` — when running in browser, the web implementation is loaded. |
| 149–151 | Re-export definitions and `LlamaCpp`. |

**Summary**: Web is a **stub** so the same JS runs in browsers without crashing. There is **no** PWA-specific logic (no service worker, no manifest in this repo), and **no** llama.cpp inference on web (no WASM, no remote API). So:

- **PWA implementation**: The project **does** have a “web” implementation in the Capacitor sense: the plugin is registered with a web implementation so that an app that uses this plugin can be built and run as a web app (or inside a PWA). That’s “PWA-ready” from a single-codebase perspective.
- **Actual PWA features**: No `manifest.json`, no service worker, no installability or offline UI logic in this repo. Those would live in the host app.
- **Llama on web**: Not implemented here; would require e.g. WebAssembly build of llama.cpp or a remote API.

---

## 5. Build Packages & Scripts

### 5.1 `package.json`

| Section | Content |
|--------|--------|
| **name** | `llama-cpp-capacitor` |
| **version** | `0.1.1` |
| **main / module / types** | `dist/plugin.cjs.js`, `dist/esm/index.js`, `types/llama-cpp-capacitor.d.ts` |
| **files** | android src, android build.gradle, cpp/, dist/, ios Sources & Frameworks, Package.swift, LlamaCpp.podspec, types/ |
| **scripts** | `verify` (iOS + Android + web); `verify:ios` (xcodebuild generic iOS); `verify:android` (gradlew clean build test); `verify:web` (npm run build); lint/fmt (eslint, prettier, swiftlint); `docgen`; `build` (clean, docgen, tsc, rollup); `build:native` (./build-native.sh); `build:ios` (cmake in ios); `build:android` (gradlew assembleRelease); test scripts; clean. |
| **devDependencies** | @capacitor/android, core, docgen, ios; eslint/prettier/swiftlint; rimraf, rollup, typescript. |
| **peerDependencies** | @capacitor/core >= 7.0.0 |
| **capacitor** | ios.src: "ios", android.src: "android" |

**Note**: `build:android` uses `gradlew.bat`; on Unix use `./gradlew` if no `.bat` wrapper.

---

### 5.2 `rollup.config.mjs`

| Part | Purpose |
|------|---------|
| **input** | `dist/esm/index.js` (TypeScript must be compiled first). |
| **output** | (1) `dist/plugin.js` — IIFE, name `capacitorLlamaCpp`, sourcemap, inlineDynamicImports; (2) `dist/plugin.cjs.js` — CJS, sourcemap, inlineDynamicImports. |
| **external** | `@capacitor/core`, `tslib`. |
| **onwarn** | Suppress `THIS_IS_UNDEFINED`. |

**Summary**: Single TS entry → ESM → Rollup bundles for CJS and IIFE (browser). No PWA-specific output (e.g. no separate web bundle); PWA would use the same bundle in the host app’s build.

---

### 5.3 `android/build.gradle`

| Part | Purpose |
|------|---------|
| **plugin** | `com.android.library` (this is a library, not an app). |
| **namespace** | `ai.annadata.plugin.capacitor`. |
| **compileSdk / minSdk / targetSdk** | 35 / 23 / 35 (from rootProject if set). |
| **ndk abiFilters** | `arm64-v8a` only. |
| **externalNativeBuild** | CMake, `src/main/CMakeLists.txt`, CMake 3.22.1, NDK 29.0.13113456. |
| **compileOptions** | Java 21. |
| **dependencies** | Capacitor Android, AppCompat, JUnit, Espresso. |

**Summary**: Builds the native lib for arm64-v8a and the Java plugin; host app adds this project as a dependency and pulls in the .so and Java classes.

---

### 5.4 iOS build

- **Xcode**: Scheme `LlamaCpp`, destination `generic/platform=iOS` (verify script).
- **CMake**: `build:ios` runs cmake in `ios/` then `cmake --build build --config Release` (builds the framework).
- **Distribution**: LlamaCpp.podspec + ios/Sources and Frameworks; framework is expected at `ios/Frameworks/llama-cpp.framework`.

---

## 6. Summary Table

| Area | iOS | Android | Web/PWA |
|------|-----|---------|---------|
| **Plugin bridge** | LlamaCppPlugin.swift (CAPPlugin) | LlamaCppPlugin.java (@CapacitorPlugin) | src/web.ts (registerPlugin web impl) |
| **Native logic** | LlamaCpp.swift (dlopen + C function pointers) | LlamaCpp.java (JNI) | None (stub) |
| **Native backend** | llama-cpp.framework (C symbols) | jni.cpp → cap-llama (C++) | N/A |
| **Real inference** | Yes, if framework exposes symbols | Yes (completion, tokenize, embedding) | No |
| **Embeddings** | Yes (if native exposes llama_embedding) | Yes (JNI embeddingNative) | No |
| **Model load** | initContext → native init | initContextNative + search paths | N/A |
| **Download/progress** | Swift URLSession-style; progress placeholder | Java download + JNI path; double callback bug | N/A |
| **PWA** | N/A | N/A | Stub only; no manifest/SW in repo |

---

## 7. Recommendations

1. **Android downloadModel**: Fix double callback (either resolve only after background download completes or return a different contract for “prepare path” vs “download complete”).
2. **Android downloadModel resolve key**: Align with TS (e.g. resolve `path` or document that plugin returns `localPath`).
3. **iOS**: Ensure all native symbols used in `loadFunctionPointers()` are exported by the built framework; otherwise init/completion/embedding will fail at runtime.
4. **PWA**: If the host app is a PWA, add manifest and service worker in the app; this repo only provides the web stub for the plugin API.
5. **verify:android**: Prefer `./gradlew` on non-Windows or add a cross-platform script.

This completes the line-by-line analysis for iOS, Android, PWA behavior, and build packages.
