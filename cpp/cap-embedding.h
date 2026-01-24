#ifndef CAP_EMBEDDING_H
#define CAP_EMBEDDING_H

#ifdef __cplusplus
extern "C" {
#endif

// Register a context for embedding operations (called when context is created)
// contextId: The context ID
// contextPtr: Pointer to the llama_cap_context
void llama_embedding_register_context(int64_t contextId, void* contextPtr);

// Unregister a context (called when context is released)
void llama_embedding_unregister_context(int64_t contextId);

// Generate embeddings for text
// contextId: The context ID
// text: Input text to embed
// paramsJson: JSON string with parameters (e.g., {"embd_normalize": 1.0})
// Returns: Pointer to float array of size n_embd, or NULL on error
// Note: The returned pointer is valid until the next call to this function on the same thread
float* llama_embedding(int64_t contextId, const char* text, const char* paramsJson);

#ifdef __cplusplus
}
#endif

#endif // CAP_EMBEDDING_H
