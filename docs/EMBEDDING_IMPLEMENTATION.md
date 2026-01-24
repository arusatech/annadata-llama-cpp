# Embedding Implementation Guide

## Overview
This document describes the proper implementation of embeddings in the llama-cpp-capacitor plugin. The previous implementation was generating random mock embeddings instead of calling the native C++ layer.

## Changes Made

### Android (Java)
1. **Added Native Method Declaration**:
   ```java
   private native Map<String, Object> embeddingNative(long contextId, String text, JSObject params);
   ```

2. **Updated `embedding()` Method**:
   - Removed mock random embedding generation
   - Now calls `embeddingNative()` to get embeddings from the C++ layer
   - Properly handles errors and logging
   - Returns result with `embedding` array and `n_embd` dimension

### iOS (Swift)
1. **Added Function Pointer**:
   ```swift
   private var embeddingFunc: ((Int64, String, UnsafePointer<Int8>) -> UnsafePointer<Float>?)?
   ```

2. **Updated `embedding()` Method**:
   - Removed empty embedding array return
   - Now calls native `llama_embedding` function
   - Converts C float array to Swift/Double array for JSON
   - Validates model has `n_embd` dimension available
   - Returns proper error if native function not available

## Native C++ Layer Requirements

### Android JNI Implementation
The C++ layer must implement:

```cpp
extern "C" JNIEXPORT jobject JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_embeddingNative(
    JNIEnv *env,
    jobject thiz,
    jlong contextId,
    jstring text,
    jobject params
) {
    // 1. Get the llama context from contextId
    // 2. Tokenize the input text
    // 3. Create a llama_batch with embeddings enabled
    // 4. Call llama_decode to get embeddings
    // 5. Extract embedding vector from the model output
    // 6. Return as Java Map with:
    //    - "embedding": double[] array
    //    - "n_embd": int dimension
}
```

### iOS C Implementation
The C++ layer must export:

```c
// Function signature expected by Swift
UnsafePointer<Float>? llama_embedding(
    Int64 contextId,
    const char* text,
    const char* paramsJson
);

// Implementation should:
// 1. Get the llama context from contextId
// 2. Tokenize the input text
// 3. Create a llama_batch with embeddings enabled
// 4. Call llama_decode to get embeddings
// 5. Return pointer to float array of size n_embd
//    (The array should remain valid until next call or context release)
```

## Implementation Details

### Embedding Generation Process
1. **Tokenize Input**: Convert text to token IDs using the model's tokenizer
2. **Create Batch**: Create `llama_batch` with:
   - `embeddings = true` to enable embedding extraction
   - Token IDs from step 1
3. **Decode**: Call `llama_decode()` to process the batch
4. **Extract Embeddings**: Get embedding vector from model output
5. **Normalize** (optional): Apply normalization if `embd_normalize` param is set
6. **Return**: Return embedding vector as array of floats/doubles

### Key llama.cpp Functions
- `llama_model_n_embd(model)`: Get embedding dimension
- `llama_batch_init()`: Initialize batch
- `llama_batch_add()`: Add tokens to batch
- `llama_decode()`: Process batch and get embeddings
- `llama_get_embeddings()` or extract from logits: Get embedding vector

### Parameters
- `embd_normalize`: Optional normalization factor (typically 1.0 or model-specific)
- `n_batch`: Batch size for processing
- `n_threads`: Number of threads for processing

## Testing
1. Load a model that supports embeddings
2. Call `embedding()` with sample text
3. Verify:
   - Returns non-empty embedding array
   - Array size matches model's `n_embd`
   - Values are reasonable (not random, not all zeros)
   - Same text produces same embeddings (deterministic)

## Error Handling
- Context not found: Return error immediately
- Model doesn't support embeddings: Return error with clear message
- Native function not available: Return `notImplemented` error
- Invalid parameters: Validate and return appropriate error

## Notes
- Embeddings should be deterministic (same input = same output)
- Embedding dimension (`n_embd`) varies by model
- Embeddings are typically normalized vectors
- The native layer must manage memory for embedding arrays properly
