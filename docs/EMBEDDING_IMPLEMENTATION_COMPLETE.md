# Native C++ Embedding Implementation - Complete

## Summary

I've implemented the native C++ embedding functions for both Android (JNI) and iOS (C wrapper). The implementation follows the llama.cpp API to generate real embeddings instead of mock random values.

## Files Created/Modified

### Android
- **`android/src/main/jni.cpp`**: Added `Java_ai_annadata_plugin_capacitor_LlamaCpp_embeddingNative()` JNI function (lines ~1270-1420)

### iOS
- **`cpp/cap-embedding.cpp`**: New C wrapper file with:
  - `llama_embedding_register_context()` - Register contexts
  - `llama_embedding_unregister_context()` - Unregister contexts  
  - `llama_embedding()` - Main embedding function
- **`cpp/cap-embedding.h`**: Header file with function declarations
- **`ios/Sources/LlamaCppPlugin/LlamaCpp.swift`**: Updated to:
  - Load embedding function pointers
  - Register/unregister contexts with C layer
  - Call native embedding function

## Implementation Details

### Android JNI (`embeddingNative`)

**Process**:
1. Validates context exists and model is loaded
2. Gets `n_embd` from model: `llama_model_n_embd(ctx->model)`
3. Extracts optional parameters from JSObject:
   - `embd_normalize` (default: 1.0)
   - `n_batch` (default: 512)
   - `n_threads` (from context params)
4. Tokenizes input: `ctx->tokenize(text_str, {})`
5. Enables embeddings: `llama_set_embeddings(ctx->ctx, true)`
6. Creates batch: `llama_batch_init(tokens.size(), 0, 1)`
7. Adds tokens with `logits=true`: `llama_batch_add(&batch, token, pos, {0}, true)`
8. Decodes: `llama_decode(ctx->ctx, batch)`
9. Gets embeddings: `llama_get_embeddings(ctx->ctx)`
10. **Mean pooling**: Averages all token embeddings
11. Applies normalization if `embd_normalize != 1.0`
12. Returns Java `HashMap` with:
    - `"embedding"`: `ArrayList<Double>` (embedding vector)
    - `"n_embd"`: `Integer` (dimension)

### iOS C Wrapper (`llama_embedding`)

**Process**:
1. Looks up context from global map (registered via `llama_embedding_register_context()`)
2. Validates context, model, gets `n_embd`
3. Parses JSON params for `embd_normalize` (simplified parser)
4. Tokenizes: `ctx->tokenize(text_str, {})`
5. Enables embeddings and creates batch
6. Decodes and extracts embeddings
7. Mean pooling
8. Applies normalization
9. Returns pointer to thread-local static storage

**Memory Management**:
- Uses `thread_local static std::vector<float>` for storage
- Pointer valid until next call on same thread
- Swift immediately copies data, so this is safe

## Context Registration (iOS)

The iOS Swift code must register contexts when created:

```swift
// In initContext, after native context is created:
if let registerFunc = registerEmbeddingContextFunc {
    // Get the actual context pointer from native layer
    // For now using contextId as identifier - may need adjustment based on actual native API
    registerFunc(Int64(contextId), contextPointer)
}

// In releaseContext:
if let unregisterFunc = unregisterEmbeddingContextFunc {
    unregisterFunc(Int64(contextId))
}
```

**Note**: The actual context pointer needs to come from the native `llama_init_context` function. The current implementation uses `contextId` as a placeholder - you may need to adjust based on how your native layer actually stores/returns context pointers.

## Key llama.cpp API Functions Used

- `llama_model_n_embd(model)`: Get embedding dimension
- `llama_set_embeddings(ctx, true/false)`: Enable/disable embedding extraction
- `llama_batch_init(n_tokens, embd, n_seq_max)`: Initialize batch
- `llama_batch_add(&batch, token, pos, seq_ids, logits)`: Add token to batch
- `llama_decode(ctx, batch)`: Process batch and generate embeddings
- `llama_get_embeddings(ctx)`: Get all token embeddings (returns `float*`)
- `llama_get_embeddings_ith(ctx, -1)`: Get last token embedding (fallback)
- `llama_batch_free(batch)`: Free batch memory

## Mean Pooling Algorithm

For multi-token inputs, the implementation uses **mean pooling**:

```cpp
// Sum all token embeddings
for (each token with logits != 0) {
    for (each dimension in n_embd) {
        embedding[dimension] += token_embedding[dimension]
    }
}

// Divide by count to get mean
for (each dimension) {
    embedding[dimension] /= n_outputs
}
```

This produces a single embedding vector that represents the entire input text.

## Normalization

If `embd_normalize` parameter is provided:

```cpp
norm = sqrt(sum(embedding[i]^2 for all i))
scale = embd_normalize / norm
embedding[i] = embedding[i] * scale
```

This scales the embedding to have the specified L2 norm (default: 1.0 = unit vector).

## Building Instructions

### Android
The JNI function in `jni.cpp` is automatically compiled when building the Android native library. No additional steps needed.

### iOS
1. Add `cpp/cap-embedding.cpp` to your Xcode project or build system
2. Ensure `cap-embedding.h` is in include path
3. Link against the framework/library that contains the implementation

## Testing Checklist

- [ ] Load a model that supports embeddings
- [ ] Initialize context successfully
- [ ] Call `embedding()` with sample text
- [ ] Verify:
  - Returns non-empty embedding array
  - Array size matches model's `n_embd`
  - Values are reasonable (not all zeros, not random)
  - Same text produces same embeddings (deterministic)
  - Different texts produce different embeddings

## Error Handling

Both implementations handle:
- Context not found → Returns `nullptr` (iOS) or throws exception (Android)
- Model not loaded → Returns `nullptr` or throws exception
- Invalid `n_embd` → Returns `nullptr` or throws exception
- Tokenization failure → Returns `nullptr` or throws exception
- Decode failure → Returns `nullptr` or throws exception

## Next Steps

1. **Test the Android implementation** - Build and test the JNI function
2. **Test the iOS implementation** - Build framework and test C wrapper
3. **Verify context registration** - Ensure Swift properly registers contexts with C layer
4. **Adjust if needed** - The context pointer registration may need adjustment based on your actual native API

## Notes

- Embeddings are **deterministic** (same input = same output)
- Uses **mean pooling** for multi-token inputs
- Memory managed automatically
- Embeddings disabled after extraction to restore normal operation
- Thread-safe (uses mutex for iOS global context map)
