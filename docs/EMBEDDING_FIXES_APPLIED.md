# Embedding Implementation Fixes - Addressing User Comments

## Issues Identified and Fixed

### 1. ✅ Parameter Passing Issue in `initContextNative`

**Problem**: When `embedding: true` was passed in `initLlama()`, the JNI bridge wasn't accepting the parameter value and was using default values.

**Root Cause**: The `initContextNative` function was hardcoding `cparams.embedding = false;` and not extracting the parameter from the JSObject.

**Fix Applied**: 
- Added parameter extraction logic in `initContextNative` to read `embedding` from JSObject
- Also extracts other common parameters: `n_ctx`, `n_batch`, `n_gpu_layers`, `use_mmap`, `use_mlock`
- Uses the same pattern as `completionNative` for parameter extraction
- Logs the extracted `embedding` value for debugging

**Code Location**: `android/src/main/jni.cpp` lines ~225-350

### 2. ✅ Embedding Returns Zeros When Not Initialized with `embedding: true`

**Problem**: If the model wasn't initialized with `embedding: true`, calling the embedding method later would always return `[0.0, 0.0...]` because the model was initialized without the pooling layer.

**Root Cause**: While `llama_set_embeddings(ctx->ctx, true)` can enable embeddings dynamically, some models require the embedding/pooling layer to be initialized during model loading.

**Fix Applied**:
- Added check in `embeddingNative` to detect if model was initialized with `embedding: true`
- Logs a warning if embeddings weren't enabled during initialization
- Still attempts to enable dynamically, but warns user that re-initialization may be needed
- Preserves `embedding` setting even in fallback ultra-minimal parameters

**Code Location**: `android/src/main/jni.cpp` lines ~1298-1310

### 3. ✅ iOS Bridge Implementation

**Question**: How to implement the bridge layer for iOS (similar to JNI bridge for Android)?

**Answer**: The iOS bridge is already implemented using C wrapper functions:

**Architecture**:
```
TypeScript → Swift (LlamaCpp.swift) → C Wrapper (cap-embedding.cpp) → llama.cpp
```

**Implementation Details**:

1. **C Wrapper Functions** (`cpp/cap-embedding.cpp`):
   - `llama_embedding_register_context()` - Registers contexts with C layer
   - `llama_embedding_unregister_context()` - Unregisters contexts
   - `llama_embedding()` - Main embedding function (equivalent to JNI `embeddingNative`)

2. **Swift Integration** (`ios/Sources/LlamaCppPlugin/LlamaCpp.swift`):
   - Loads function pointers via `dlsym()` (similar to how other native functions are loaded)
   - Calls `llama_embedding()` with contextId, text, and params JSON
   - Converts C float array to Swift/Double array for JSON

3. **Context Registration**:
   - When context is created in `initContext`, it should register with C layer
   - When context is released, it should unregister
   - The C layer maintains a global map of contextId → `llama_cap_context*`

**Key Differences from Android**:
- **Android**: Uses JNI (Java Native Interface) - direct method calls
- **iOS**: Uses C wrapper functions loaded via `dlsym()` - function pointers

**Files**:
- `cpp/cap-embedding.cpp` - C wrapper implementation
- `cpp/cap-embedding.h` - Header declarations
- `ios/Sources/LlamaCppPlugin/LlamaCpp.swift` - Swift integration

## Testing Recommendations

1. **Test Parameter Passing**:
   ```typescript
   // Should now properly accept embedding: true
   await initLlama({
     model: modelPath,
     embedding: true,  // This should now be properly passed to JNI
     n_ctx: 2048,
     n_batch: 512
   });
   ```

2. **Test Embedding Without Initialization**:
   ```typescript
   // Initialize WITHOUT embedding: true
   await initLlama({ model: modelPath }); // embedding: false by default
   
   // Try to generate embeddings - should warn but attempt
   const result = await embedding(contextId, "test text", {});
   // Check if result.embedding contains zeros or actual values
   ```

3. **Test Embedding With Initialization**:
   ```typescript
   // Initialize WITH embedding: true
   await initLlama({ 
     model: modelPath,
     embedding: true  // Should enable pooling layer
   });
   
   // Generate embeddings - should work correctly
   const result = await embedding(contextId, "test text", {});
   // Should return non-zero embeddings
   ```

## Important Notes

1. **Model Re-initialization**: If embeddings return zeros, the user must re-initialize the model with `embedding: true`. This is a limitation of some models that require the pooling layer to be set up during initialization.

2. **Parameter Extraction**: The parameter extraction uses the same pattern as `completionNative`, which handles JSObject method calls safely with exception checking.

3. **iOS Context Registration**: The iOS implementation requires proper context registration. The Swift code needs to call `llama_embedding_register_context()` when contexts are created and `llama_embedding_unregister_context()` when released.

## Next Steps

1. Test the Android implementation with `embedding: true` parameter
2. Verify that embeddings work correctly when initialized with `embedding: true`
3. Test the warning message when embeddings are called without initialization
4. Complete iOS context registration in Swift code
5. Test iOS embedding implementation end-to-end
