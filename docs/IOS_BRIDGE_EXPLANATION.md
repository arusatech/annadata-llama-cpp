# iOS Bridge Implementation Explanation

## Overview

This document explains how the iOS bridge layer works for embeddings, similar to the JNI bridge for Android.

## Architecture Comparison

### Android (JNI Bridge)
```
TypeScript → Java (LlamaCpp.java) → JNI (jni.cpp) → llama.cpp
```

**Flow**:
1. TypeScript calls `embedding()` method
2. Java method `embedding()` in `LlamaCpp.java` calls native method `embeddingNative()`
3. JNI function `Java_ai_annadata_plugin_capacitor_LlamaCpp_embeddingNative()` in `jni.cpp` executes
4. Calls llama.cpp functions directly

### iOS (C Wrapper Bridge)
```
TypeScript → Swift (LlamaCpp.swift) → C Wrapper (cap-embedding.cpp) → llama.cpp
```

**Flow**:
1. TypeScript calls `embedding()` method
2. Swift method `embedding()` in `LlamaCpp.swift` calls C function pointer `embeddingFunc`
3. C function `llama_embedding()` in `cap-embedding.cpp` executes
4. Calls llama.cpp functions directly

## Key Differences

| Aspect | Android (JNI) | iOS (C Wrapper) |
|--------|---------------|-----------------|
| **Interface** | JNI method names (auto-generated) | C function pointers (loaded via `dlsym`) |
| **Method Signature** | `Java_ai_annadata_plugin_capacitor_LlamaCpp_embeddingNative(...)` | `llama_embedding(int64_t, const char*, const char*)` |
| **Loading** | Automatic (JNI runtime) | Manual (`dlsym` in Swift) |
| **Context Storage** | Global map in `jni.cpp` | Global map in `cap-embedding.cpp` |
| **Parameter Passing** | JNI types (`jstring`, `jobject`) | C types (`const char*`, `int64_t`) |

## iOS Implementation Details

### 1. C Wrapper Functions (`cpp/cap-embedding.cpp`)

**Function**: `llama_embedding(int64_t contextId, const char* text, const char* paramsJson)`

**Purpose**: Equivalent to Android's `embeddingNative()` JNI function

**How it works**:
1. Looks up context from global map using `contextId`
2. Tokenizes input text
3. Creates batch and enables embeddings
4. Decodes to get embeddings
5. Performs mean pooling
6. Returns pointer to float array

**Context Management**:
- `llama_embedding_register_context()` - Registers context when created
- `llama_embedding_unregister_context()` - Unregisters context when released
- Global map: `std::map<int64_t, capllama::llama_cap_context*>`

### 2. Swift Integration (`ios/Sources/LlamaCppPlugin/LlamaCpp.swift`)

**Function Pointer Loading**:
```swift
private var embeddingFunc: ((Int64, String, UnsafePointer<Int8>) -> UnsafePointer<Float>?)?

private func loadFunctionPointers() {
    guard let library = llamaLibrary else { return }
    embeddingFunc = unsafeBitCast(
        dlsym(library, "llama_embedding"), 
        to: ((Int64, String, UnsafePointer<Int8>) -> UnsafePointer<Float>?).self
    )
}
```

**Calling the Native Function**:
```swift
func embedding(contextId: Int, text: String, params: [String: Any], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
    // Convert params to JSON string
    let paramsJson = try JSONSerialization.data(withJSONObject: params)
    let paramsCString = paramsJson.cString(using: .utf8)
    
    // Call C function via function pointer
    if let embeddingPtr = embeddingFunc?(Int64(contextId), text, paramsCString) {
        // Convert C float array to Swift array
        let embeddingArray = Array(UnsafeBufferPointer(start: embeddingPtr, count: nEmbd))
        // Convert to Double for JSON
        let embeddingDoubles = embeddingArray.map { Double($0) }
        // Return result
        completion(.success(["embedding": embeddingDoubles, "n_embd": nEmbd]))
    }
}
```

### 3. Context Registration

**When Context is Created** (`initContext`):
```swift
// After native context is created
if let registerFunc = registerEmbeddingContextFunc {
    registerFunc(Int64(contextId), contextPointer)
}
```

**When Context is Released** (`releaseContext`):
```swift
// Before releasing context
if let unregisterFunc = unregisterEmbeddingContextFunc {
    unregisterFunc(Int64(contextId))
}
```

## Why C Wrapper Instead of Direct Swift?

1. **Consistency**: Other native functions (completion, tokenize) use the same pattern
2. **Dynamic Loading**: Functions are loaded at runtime via `dlsym`, allowing the framework to be optional
3. **C Compatibility**: C functions can be called from Swift easily via function pointers
4. **No JNI Equivalent**: iOS doesn't have JNI - C wrappers are the standard approach

## Building and Linking

### Android
- JNI functions are automatically linked when building the native library
- No additional configuration needed

### iOS
1. Add `cpp/cap-embedding.cpp` to Xcode project
2. Ensure `cap-embedding.h` is in include path
3. Link against the framework/library containing llama.cpp
4. Functions are exported and can be loaded via `dlsym`

## Function Export

The C functions must be exported so `dlsym` can find them:

```cpp
extern "C" {
    float* llama_embedding(int64_t contextId, const char* text, const char* paramsJson);
    void llama_embedding_register_context(int64_t contextId, void* contextPtr);
    void llama_embedding_unregister_context(int64_t contextId);
}
```

The `extern "C"` ensures C linkage (no name mangling), making the functions findable by `dlsym`.

## Memory Management

### Android (JNI)
- JNI handles memory management automatically
- Java objects are garbage collected
- Native memory is managed by C++

### iOS (C Wrapper)
- Uses thread-local static storage for embedding results
- Pointer remains valid until next call on same thread
- Swift immediately copies the data, so this is safe
- Context pointers are managed by the global map

## Error Handling

### Android
- Throws Java exceptions via `throw_java_exception()`
- Java catches and converts to error callbacks

### iOS
- Returns `nullptr` on error
- Swift checks for `nullptr` and converts to error callbacks
- Uses `LlamaResult.failure()` for error reporting

## Summary

The iOS bridge uses **C wrapper functions** loaded via **function pointers** (`dlsym`), which is the iOS equivalent of Android's JNI bridge. The implementation follows the same pattern as other native functions in the codebase and provides the same functionality as the Android JNI implementation.
