# Native C++ Embedding Implementation

## Overview
This document describes the native C++ implementation for embeddings in both Android (JNI) and iOS (C wrapper).

## Files Created/Modified

### Android
- **`android/src/main/jni.cpp`**: Added `Java_ai_annadata_plugin_capacitor_LlamaCpp_embeddingNative()` JNI function

### iOS  
- **`cpp/cap-embedding.cpp`**: New C wrapper file with `llama_embedding()` function
- **`cpp/cap-embedding.h`**: Header file with function declarations

## Implementation Details

### Android JNI Implementation

**Function**: `Java_ai_annadata_plugin_capacitor_LlamaCpp_embeddingNative()`

**Process**:
1. Validates context exists and model is loaded
2. Gets `n_embd` from model using `llama_model_n_embd()`
3. Extracts optional parameters from JSObject (`embd_normalize`, `n_batch`, `n_threads`)
4. Tokenizes input text using `ctx->tokenize()`
5. Enables embeddings: `llama_set_embeddings(ctx->ctx, true)`
6. Creates `llama_batch` and adds tokens with `logits=true`
7. Calls `llama_decode()` to process the batch
8. Gets embeddings using `llama_get_embeddings()`
9. Performs **mean pooling** (averages all token embeddings)
10. Applies normalization if `embd_normalize` is specified
11. Returns Java `HashMap` with `embedding` (Double array) and `n_embd` (Integer)

### iOS C Wrapper Implementation

**Function**: `llama_embedding(int64_t contextId, const char* text, const char* paramsJson)`

**Process**:
1. Looks up context from global context map (registered via `llama_embedding_register_context()`)
2. Validates context, model, and gets `n_embd`
3. Parses JSON params for `embd_normalize` (simplified parser - can be enhanced)
4. Tokenizes text using `ctx->tokenize()`
5. Enables embeddings and creates batch
6. Decodes batch and extracts embeddings
7. Performs mean pooling
8. Applies normalization if specified
9. Returns pointer to thread-local static storage (valid until next call)

**Memory Management**:
- Uses `thread_local static std::vector<float>` for storage
- Pointer remains valid until next call on same thread
- Swift code immediately copies the data, so this is safe

## Context Registration

For iOS, contexts must be registered with the C layer:

```swift
// When creating a context (in initContext):
if let contextPtr = /* get pointer from native initContext function */ {
    // Register with embedding system
    let registerFunc = dlsym(library, "llama_embedding_register_context")
    // Call registerFunc(contextId, contextPtr)
}

// When releasing a context:
let unregisterFunc = dlsym(library, "llama_embedding_unregister_context")
// Call unregisterFunc(contextId)
```

## Building

### Android
The JNI function is automatically compiled when building the Android native library. Ensure `jni.cpp` is included in the build.

### iOS
Add `cap-embedding.cpp` to your Xcode project or build system. The file should be compiled and linked into the framework.

## Testing

1. **Load a model** that supports embeddings
2. **Initialize a context** with the model
3. **Call embedding()** with sample text
4. **Verify**:
   - Returns non-empty embedding array
   - Array size matches model's `n_embd`
   - Values are reasonable (not all zeros, not random)
   - Same text produces same embeddings (deterministic)

## Key llama.cpp Functions Used

- `llama_model_n_embd(model)`: Get embedding dimension
- `llama_set_embeddings(ctx, true)`: Enable embedding extraction
- `llama_batch_init()`: Initialize batch
- `llama_batch_add()`: Add tokens to batch
- `llama_decode()`: Process batch and generate embeddings
- `llama_get_embeddings(ctx)`: Get all token embeddings
- `llama_get_embeddings_ith(ctx, -1)`: Get last token embedding (fallback)
- `llama_set_embeddings(ctx, false)`: Disable embeddings (restore normal operation)

## Mean Pooling

The implementation uses **mean pooling** to combine multiple token embeddings into a single vector:
- Sums all token embeddings
- Divides by number of tokens
- This is a common approach for text embeddings

## Normalization

If `embd_normalize` parameter is provided:
- Calculates L2 norm of the embedding vector
- Scales the vector to have the specified norm
- Default is 1.0 (unit vector normalization)

## Error Handling

- **Context not found**: Returns `nullptr` (iOS) or throws exception (Android)
- **Model not loaded**: Returns `nullptr` or throws exception
- **Invalid n_embd**: Returns `nullptr` or throws exception
- **Tokenization failure**: Returns `nullptr` or throws exception
- **Decode failure**: Returns `nullptr` or throws exception

## Notes

- Embeddings are **deterministic** (same input = same output)
- The implementation uses **mean pooling** for multi-token inputs
- Memory is managed automatically (thread-local storage for iOS, JNI for Android)
- Embeddings are disabled after extraction to restore normal operation
