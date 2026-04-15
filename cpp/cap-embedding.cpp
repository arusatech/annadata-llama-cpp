// C wrapper functions for iOS embedding support
// These functions are loaded via dlsym in Swift

#include "cap-llama.h"
#include "llama.h"
#include "common.h"
#include <cstring>
#include <cmath>
#include <vector>
#include <map>
#include <mutex>

// Global context storage for iOS
// This maps contextId to the actual llama_cap_context pointer
// Contexts are registered when created and unregistered when released
static std::map<int64_t, capllama::llama_cap_context*> g_contexts;
static std::mutex g_contexts_mutex;

// Register a context (called from Swift when context is created via initContext)
// This allows the C embedding function to look up contexts by ID
extern "C" void llama_embedding_register_context(int64_t contextId, void* contextPtr) {
    if (contextPtr == nullptr) return;
    std::lock_guard<std::mutex> lock(g_contexts_mutex);
    g_contexts[contextId] = static_cast<capllama::llama_cap_context*>(contextPtr);
}

// Unregister a context (called from Swift when context is released)
extern "C" void llama_embedding_unregister_context(int64_t contextId) {
    std::lock_guard<std::mutex> lock(g_contexts_mutex);
    g_contexts.erase(contextId);
}

// C wrapper function for iOS embedding
// Signature: float* llama_embedding(int64_t contextId, const char* text, const char* paramsJson)
// Returns: pointer to float array of size n_embd, or NULL on error
// Memory: The returned pointer points to thread-local static storage that remains valid until next call
extern "C" float* llama_embedding(int64_t contextId, const char* text, const char* paramsJson) {
    static thread_local std::vector<float> embedding_storage;
    
    try {
        std::lock_guard<std::mutex> lock(g_contexts_mutex);
        
        // Find the context
        auto it = g_contexts.find(contextId);
        if (it == g_contexts.end() || it->second == nullptr) {
            return nullptr;
        }
        
        capllama::llama_cap_context* ctx_ptr = it->second;
        if (ctx_ptr == nullptr || ctx_ptr->ctx == nullptr || ctx_ptr->model == nullptr) {
            return nullptr;
        }
        
        capllama::llama_cap_context& ctx = *ctx_ptr;
        
        // Get embedding dimension from model
        int32_t n_embd = llama_model_n_embd(ctx.model);
        if (n_embd <= 0) {
            return nullptr;
        }
        
        // Parse params JSON if provided (optional)
        double embd_normalize = 1.0;
        if (paramsJson != nullptr && strlen(paramsJson) > 0) {
            try {
                // Simple JSON parsing for embd_normalize
                // For a full implementation, use a JSON library
                if (strstr(paramsJson, "embd_normalize") != nullptr) {
                    // Extract value (simplified - use proper JSON parser in production)
                    const char* normalize_str = strstr(paramsJson, "embd_normalize");
                    if (normalize_str != nullptr) {
                        normalize_str = strchr(normalize_str, ':');
                        if (normalize_str != nullptr) {
                            embd_normalize = strtod(normalize_str + 1, nullptr);
                        }
                    }
                }
            } catch (...) {
                // Use default if parsing fails
                embd_normalize = 1.0;
            }
        }
        
        // Tokenize the input text
        std::string text_str(text);
        capllama::llama_cap_tokenize_result tokenize_result = ctx.tokenize(text_str, {});
        std::vector<llama_token> tokens = tokenize_result.tokens;
        
        if (tokens.empty()) {
            return nullptr;
        }
        
        // Enable embeddings in the context
        llama_set_embeddings(ctx.ctx, true);
        
        // Create a batch for embedding extraction
        llama_batch batch = llama_batch_init(tokens.size(), 0, 1);
        
        // Add tokens to batch with embeddings enabled
        for (size_t i = 0; i < tokens.size(); i++) {
            capllama::llama_batch_add(&batch, tokens[i], i, {0}, true); // logits=true to get embeddings
        }
        
        // Decode the batch to get embeddings
        int decode_result = llama_decode(ctx.ctx, batch);
        if (decode_result != 0) {
            llama_batch_free(batch);
            llama_set_embeddings(ctx.ctx, false);
            return nullptr;
        }
        
        // Get embeddings from the context
        float* embeddings_ptr = llama_get_embeddings(ctx.ctx);
        if (embeddings_ptr == nullptr) {
            llama_batch_free(batch);
            llama_set_embeddings(ctx.ctx, false);
            return nullptr;
        }
        
        // Resize storage for this embedding
        embedding_storage.resize(n_embd);
        
        // Count how many tokens have embeddings (logits != 0)
        int n_outputs = 0;
        for (int i = 0; i < batch.n_tokens; i++) {
            if (batch.logits[i] != 0) {
                n_outputs++;
            }
        }
        
        if (n_outputs > 0) {
            // Mean pooling: sum all token embeddings, then divide by count
            std::memset(embedding_storage.data(), 0, n_embd * sizeof(float));
            
            for (int i = 0; i < n_outputs; i++) {
                float* token_embd = embeddings_ptr + (i * n_embd);
                for (int j = 0; j < n_embd; j++) {
                    embedding_storage[j] += token_embd[j];
                }
            }
            
            // Divide by number of outputs to get mean
            for (int j = 0; j < n_embd; j++) {
                embedding_storage[j] /= n_outputs;
            }
        } else {
            // Fallback: use the last token's embedding if available
            float* last_embd = llama_get_embeddings_ith(ctx.ctx, -1);
            if (last_embd != nullptr) {
                std::memcpy(embedding_storage.data(), last_embd, n_embd * sizeof(float));
            } else {
                llama_batch_free(batch);
                llama_set_embeddings(ctx.ctx, false);
                return nullptr;
            }
        }
        
        // Apply normalization if specified
        if (embd_normalize != 1.0 && embd_normalize != 0.0) {
            float norm = 0.0f;
            for (int i = 0; i < n_embd; i++) {
                norm += embedding_storage[i] * embedding_storage[i];
            }
            norm = std::sqrt(norm);
            if (norm > 0.0f) {
                float scale = static_cast<float>(embd_normalize) / norm;
                for (int i = 0; i < n_embd; i++) {
                    embedding_storage[i] *= scale;
                }
            }
        }
        
        // Clean up batch
        llama_batch_free(batch);
        
        // Disable embeddings to restore normal operation
        llama_set_embeddings(ctx.ctx, false);
        
        // Return pointer to thread-local storage
        // Note: This remains valid until the next call to this function on the same thread
        return embedding_storage.data();
        
    } catch (const std::exception& e) {
        return nullptr;
    } catch (...) {
        return nullptr;
    }
}
