#include "jni-utils.h"
#include "cap-llama.h"
#include "cap-completion.h"
#include <android/log.h>
#include <cstring>
#include <memory>
#include <fstream> // Added for file existence and size checks
#include <signal.h> // Added for signal handling
#include <sys/signal.h> // Added for sigaction
#include <thread> // For background downloads
#include <atomic> // For thread-safe progress tracking
#include <filesystem> // For file operations
#include <mutex> // For thread synchronization

// Add missing symbol
// namespace rnllama {
//     bool rnllama_verbose = false;
// }

#define LOG_TAG "LlamaCpp"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace jni_utils {

std::string jstring_to_string(JNIEnv* env, jstring jstr) {
    if (jstr == nullptr) return "";
    const char* chars = env->GetStringUTFChars(jstr, nullptr);
    std::string str(chars);
    env->ReleaseStringUTFChars(jstr, chars);
    return str;
}

jstring string_to_jstring(JNIEnv* env, const std::string& str) {
    return env->NewStringUTF(str.c_str());
}

std::vector<std::string> jstring_array_to_string_vector(JNIEnv* env, jobjectArray jarray) {
    std::vector<std::string> result;
    if (jarray == nullptr) return result;
    
    jsize length = env->GetArrayLength(jarray);
    for (jsize i = 0; i < length; i++) {
        jstring jstr = (jstring)env->GetObjectArrayElement(jarray, i);
        result.push_back(jstring_to_string(env, jstr));
        env->DeleteLocalRef(jstr);
    }
    return result;
}

jobjectArray string_vector_to_jstring_array(JNIEnv* env, const std::vector<std::string>& vec) {
    jclass stringClass = env->FindClass("java/lang/String");
    jobjectArray result = env->NewObjectArray(vec.size(), stringClass, nullptr);
    
    for (size_t i = 0; i < vec.size(); i++) {
        jstring jstr = string_to_jstring(env, vec[i]);
        env->SetObjectArrayElement(result, i, jstr);
        env->DeleteLocalRef(jstr);
    }
    return result;
}

bool jboolean_to_bool(jboolean jbool) {
    return jbool == JNI_TRUE;
}

jboolean bool_to_jboolean(bool b) {
    return b ? JNI_TRUE : JNI_FALSE;
}

int jint_to_int(jint jint_val) {
    return static_cast<int>(jint_val);
}

jint int_to_jint(int val) {
    return static_cast<jint>(val);
}

float jfloat_to_float(jfloat jfloat_val) {
    return static_cast<float>(jfloat_val);
}

jfloat float_to_jfloat(float val) {
    return static_cast<jfloat>(val);
}

long jlong_to_long(jlong jlong_val) {
    return static_cast<long>(jlong_val);
}

jlong long_to_jlong(long val) {
    return static_cast<jlong>(val);
}

double jdouble_to_double(jdouble jdouble_val) {
    return static_cast<double>(jdouble_val);
}

jdouble double_to_jdouble(double val) {
    return static_cast<jdouble>(val);
}

void throw_java_exception(JNIEnv* env, const char* class_name, const char* message) {
    jclass exceptionClass = env->FindClass(class_name);
    if (exceptionClass != nullptr) {
        env->ThrowNew(exceptionClass, message);
    }
}

bool check_exception(JNIEnv* env) {
    return env->ExceptionCheck() == JNI_TRUE;
}

jfieldID get_field_id(JNIEnv* env, jclass clazz, const char* name, const char* sig) {
    jfieldID fieldID = env->GetFieldID(clazz, name, sig);
    if (check_exception(env)) {
        return nullptr;
    }
    return fieldID;
}

jmethodID get_method_id(JNIEnv* env, jclass clazz, const char* name, const char* sig) {
    jmethodID methodID = env->GetMethodID(clazz, name, sig);
    if (check_exception(env)) {
        return nullptr;
    }
    return methodID;
}

jclass find_class(JNIEnv* env, const char* name) {
    jclass clazz = env->FindClass(name);
    if (check_exception(env)) {
        return nullptr;
    }
    return clazz;
}

// Convert llama_cap_context to jobject
jobject llama_context_to_jobject(JNIEnv* env, const capllama::llama_cap_context* context);

// Convert jobject to llama_cap_context
capllama::llama_cap_context* jobject_to_llama_context(JNIEnv* env, jobject obj);

// Convert completion result to jobject
jobject completion_result_to_jobject(JNIEnv* env, const capllama::completion_token_output& result);

// Convert tokenize result to jobject
jobject tokenize_result_to_jobject(JNIEnv* env, const capllama::llama_cap_tokenize_result& result);

// Global context storage - fix namespace
static std::map<jlong, std::unique_ptr<capllama::llama_cap_context>> contexts;
static jlong next_context_id = 1;

// Download progress tracking (simplified for now)
// This can be enhanced later to track actual download progress

extern "C" {

JNIEXPORT jlong JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_initContextNative(
    JNIEnv *env, jobject thiz, jstring modelPath, jobjectArray searchPaths, jobject params) {
    
    try {
        std::string model_path_str = jstring_to_string(env, modelPath);
        
        // Get search paths from Java
        jsize pathCount = env->GetArrayLength(searchPaths);
        std::vector<std::string> paths_to_check;
        
        // Add the original path first
        paths_to_check.push_back(model_path_str);
        
        // Add all search paths from Java
        for (jsize i = 0; i < pathCount; i++) {
            jstring pathJString = (jstring)env->GetObjectArrayElement(searchPaths, i);
            std::string path = jstring_to_string(env, pathJString);
            paths_to_check.push_back(path);
            env->DeleteLocalRef(pathJString);
        }
        
        // Rest of the existing logic remains the same...
        std::string full_model_path;
        bool file_found = false;
        
        for (const auto& path : paths_to_check) {
            LOGI("Checking path: %s", path.c_str());
            if (std::filesystem::exists(path)) {
                full_model_path = path;
                file_found = true;
                LOGI("Found model file at: %s", path.c_str());
                break;
            } else {
                LOGE("Path not found: %s", path.c_str());
            }
        }
        
        if (!file_found) {
            LOGE("Model file not found in any of the search paths");
            return -1;
        }
        
        // Additional model validation
        LOGI("Performing additional model validation...");
        std::ifstream validation_file(full_model_path, std::ios::binary);
        if (validation_file.good()) {
            // Read first 8 bytes to check GGUF version
            char header[8];
            if (validation_file.read(header, 8)) {
                uint32_t version = *reinterpret_cast<uint32_t*>(header + 4);
                LOGI("GGUF version: %u", version);
                
                // Check if version is reasonable (should be > 0 and < 1000)
                if (version == 0 || version > 1000) {
                    LOGE("Suspicious GGUF version: %u", version);
                    LOGI("This might indicate a corrupted or incompatible model file");
                }
            }
            validation_file.close();
        }

        // Create new context - fix namespace
        auto context = std::make_unique<capllama::llama_cap_context>();
        LOGI("Created llama_cap_context");
        
        // Initialize common parameters with defaults
        common_params cparams;
        cparams.model.path = full_model_path;
        cparams.n_ctx = 2048;
        cparams.n_batch = 512;
        cparams.n_gpu_layers = 0;
        cparams.rope_freq_base = 10000.0f;
        cparams.rope_freq_scale = 1.0f;
        cparams.use_mmap = true;
        cparams.use_mlock = false;
        cparams.numa = LM_GGML_NUMA_STRATEGY_DISABLED;
        cparams.ctx_shift = false;
        cparams.chat_template = "";
        cparams.embedding = false;  // Default to false, will be extracted from params if provided
        cparams.cont_batching = false;
        cparams.n_parallel = 1;
        cparams.antiprompt.clear();
        cparams.vocab_only = false;
        cparams.rope_scaling_type = LLAMA_ROPE_SCALING_TYPE_UNSPECIFIED;
        cparams.yarn_ext_factor = -1.0f;
        cparams.yarn_attn_factor = 1.0f;
        cparams.yarn_beta_fast = 32.0f;
        cparams.yarn_beta_slow = 1.0f;
        cparams.yarn_orig_ctx = 0;
        cparams.flash_attn = false;
        cparams.n_keep = 0;
        cparams.n_chunks = -1;
        cparams.n_sequences = 1;
        cparams.model_alias = "unknown";
        
        // Extract parameters from JSObject if provided
        // This fixes the issue where embedding: true parameter wasn't being accepted
        if (params != nullptr) {
            jclass jsObjectClass = env->GetObjectClass(params);
            if (jsObjectClass != nullptr && !env->ExceptionCheck()) {
                // Clear any pending exceptions first
                if (env->ExceptionCheck()) {
                    env->ExceptionClear();
                }
                
                // Get method IDs for parameter extraction
                jmethodID getBooleanMethod = nullptr;
                jmethodID getIntegerMethod = nullptr;
                jmethodID getDoubleMethod = nullptr;
                jmethodID getStringMethod = nullptr;
                
                try {
                    getBooleanMethod = env->GetMethodID(jsObjectClass, "getBoolean", "(Ljava/lang/String;)Ljava/lang/Boolean;");
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                        getBooleanMethod = nullptr;
                    }
                    
                    getIntegerMethod = env->GetMethodID(jsObjectClass, "getInteger", "(Ljava/lang/String;)Ljava/lang/Integer;");
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                        getIntegerMethod = nullptr;
                    }
                    
                    getDoubleMethod = env->GetMethodID(jsObjectClass, "getDouble", "(Ljava/lang/String;)Ljava/lang/Double;");
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                        getDoubleMethod = nullptr;
                    }
                    
                    getStringMethod = env->GetMethodID(jsObjectClass, "getString", "(Ljava/lang/String;)Ljava/lang/String;");
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                        getStringMethod = nullptr;
                    }
                } catch (...) {
                    LOGE("Exception getting JSObject method IDs in initContext");
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                }
                
                // Extract embedding parameter (CRITICAL FIX)
                if (getBooleanMethod != nullptr) {
                    jstring embeddingKey = jni_utils::string_to_jstring(env, "embedding");
                    jobject embeddingObj = env->CallObjectMethod(params, getBooleanMethod, embeddingKey);
                    if (embeddingObj != nullptr && !env->ExceptionCheck()) {
                        jclass booleanClass = env->FindClass("java/lang/Boolean");
                        jmethodID booleanValueMethod = env->GetMethodID(booleanClass, "booleanValue", "()Z");
                        if (booleanValueMethod != nullptr && !env->ExceptionCheck()) {
                            jboolean embeddingValue = env->CallBooleanMethod(embeddingObj, booleanValueMethod);
                            cparams.embedding = (embeddingValue == JNI_TRUE);
                            LOGI("Extracted embedding parameter: %s", cparams.embedding ? "true" : "false");
                        }
                        env->DeleteLocalRef(embeddingObj);
                    }
                    env->DeleteLocalRef(embeddingKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                }
                
                // Extract other common parameters
                if (getIntegerMethod != nullptr) {
                    // Extract n_ctx
                    jstring nCtxKey = jni_utils::string_to_jstring(env, "n_ctx");
                    jobject nCtxObj = env->CallObjectMethod(params, getIntegerMethod, nCtxKey);
                    if (nCtxObj != nullptr && !env->ExceptionCheck()) {
                        jclass integerClass = env->FindClass("java/lang/Integer");
                        jmethodID intValueMethod = env->GetMethodID(integerClass, "intValue", "()I");
                        if (intValueMethod != nullptr && !env->ExceptionCheck()) {
                            cparams.n_ctx = env->CallIntMethod(nCtxObj, intValueMethod);
                        }
                        env->DeleteLocalRef(nCtxObj);
                    }
                    env->DeleteLocalRef(nCtxKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                    
                    // Extract n_batch
                    jstring nBatchKey = jni_utils::string_to_jstring(env, "n_batch");
                    jobject nBatchObj = env->CallObjectMethod(params, getIntegerMethod, nBatchKey);
                    if (nBatchObj != nullptr && !env->ExceptionCheck()) {
                        jclass integerClass = env->FindClass("java/lang/Integer");
                        jmethodID intValueMethod = env->GetMethodID(integerClass, "intValue", "()I");
                        if (intValueMethod != nullptr && !env->ExceptionCheck()) {
                            cparams.n_batch = env->CallIntMethod(nBatchObj, intValueMethod);
                        }
                        env->DeleteLocalRef(nBatchObj);
                    }
                    env->DeleteLocalRef(nBatchKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                    
                    // Extract n_gpu_layers
                    jstring nGpuLayersKey = jni_utils::string_to_jstring(env, "n_gpu_layers");
                    jobject nGpuLayersObj = env->CallObjectMethod(params, getIntegerMethod, nGpuLayersKey);
                    if (nGpuLayersObj != nullptr && !env->ExceptionCheck()) {
                        jclass integerClass = env->FindClass("java/lang/Integer");
                        jmethodID intValueMethod = env->GetMethodID(integerClass, "intValue", "()I");
                        if (intValueMethod != nullptr && !env->ExceptionCheck()) {
                            cparams.n_gpu_layers = env->CallIntMethod(nGpuLayersObj, intValueMethod);
                        }
                        env->DeleteLocalRef(nGpuLayersObj);
                    }
                    env->DeleteLocalRef(nGpuLayersKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                }
                
                // Extract boolean parameters
                if (getBooleanMethod != nullptr) {
                    // Extract use_mmap
                    jstring useMmapKey = jni_utils::string_to_jstring(env, "use_mmap");
                    jobject useMmapObj = env->CallObjectMethod(params, getBooleanMethod, useMmapKey);
                    if (useMmapObj != nullptr && !env->ExceptionCheck()) {
                        jclass booleanClass = env->FindClass("java/lang/Boolean");
                        jmethodID booleanValueMethod = env->GetMethodID(booleanClass, "booleanValue", "()Z");
                        if (booleanValueMethod != nullptr && !env->ExceptionCheck()) {
                            cparams.use_mmap = (env->CallBooleanMethod(useMmapObj, booleanValueMethod) == JNI_TRUE);
                        }
                        env->DeleteLocalRef(useMmapObj);
                    }
                    env->DeleteLocalRef(useMmapKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                    
                    // Extract use_mlock
                    jstring useMlockKey = jni_utils::string_to_jstring(env, "use_mlock");
                    jobject useMlockObj = env->CallObjectMethod(params, getBooleanMethod, useMlockKey);
                    if (useMlockObj != nullptr && !env->ExceptionCheck()) {
                        jclass booleanClass = env->FindClass("java/lang/Boolean");
                        jmethodID booleanValueMethod = env->GetMethodID(booleanClass, "booleanValue", "()Z");
                        if (booleanValueMethod != nullptr && !env->ExceptionCheck()) {
                            cparams.use_mlock = (env->CallBooleanMethod(useMlockObj, booleanValueMethod) == JNI_TRUE);
                        }
                        env->DeleteLocalRef(useMlockObj);
                    }
                    env->DeleteLocalRef(useMlockKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                }
            }
        }

        LOGI("Initialized common parameters, attempting to load model from: %s", full_model_path.c_str());
        LOGI("Model parameters: n_ctx=%d, n_batch=%d, n_gpu_layers=%d, embedding=%s", 
             cparams.n_ctx, cparams.n_batch, cparams.n_gpu_layers, cparams.embedding ? "true" : "false");
        
        // Try to load the model with error handling and signal protection
        bool load_success = false;
        
        // Set up signal handler to catch segmentation faults
        struct sigaction old_action;
        struct sigaction new_action;
        new_action.sa_handler = [](int sig) {
            LOGE("Segmentation fault caught during model loading");
            // Restore default handler and re-raise signal
            signal(sig, SIG_DFL);
            raise(sig);
        };
        new_action.sa_flags = SA_RESETHAND;
        sigemptyset(&new_action.sa_mask);
        
        if (sigaction(SIGSEGV, &new_action, &old_action) == 0) {
            LOGI("Signal handler installed for segmentation fault protection");
        }
        
        try {
            LOGI("Attempting to load model with standard parameters...");
            load_success = context->loadModel(cparams);
        } catch (const std::exception& e) {
            LOGE("Exception during model loading: %s", e.what());
            load_success = false;
        } catch (...) {
            LOGE("Unknown exception during model loading");
            load_success = false;
        }
        
        // Restore original signal handler
        sigaction(SIGSEGV, &old_action, nullptr);
        
        if (!load_success) {
            LOGE("context->loadModel() returned false - model loading failed");
            
            // Try with ultra-minimal parameters as fallback
            LOGI("Trying with ultra-minimal parameters...");
            common_params ultra_minimal_params;
            ultra_minimal_params.model.path = full_model_path;
            ultra_minimal_params.n_ctx = 256;  // Very small context
            ultra_minimal_params.n_batch = 128; // Very small batch
            ultra_minimal_params.n_gpu_layers = 0;
            ultra_minimal_params.use_mmap = false; // Disable mmap to avoid memory issues
            ultra_minimal_params.use_mlock = false;
            ultra_minimal_params.numa = LM_GGML_NUMA_STRATEGY_DISABLED;
            ultra_minimal_params.ctx_shift = false;
            ultra_minimal_params.chat_template = "";
            ultra_minimal_params.embedding = cparams.embedding; // Preserve embedding setting even in fallback
            ultra_minimal_params.cont_batching = false;
            ultra_minimal_params.n_parallel = 1;
            ultra_minimal_params.antiprompt.clear();
            ultra_minimal_params.vocab_only = false;
            ultra_minimal_params.rope_scaling_type = LLAMA_ROPE_SCALING_TYPE_UNSPECIFIED;
            ultra_minimal_params.yarn_ext_factor = -1.0f;
            ultra_minimal_params.yarn_attn_factor = 1.0f;
            ultra_minimal_params.yarn_beta_fast = 32.0f;
            ultra_minimal_params.yarn_beta_slow = 1.0f;
            ultra_minimal_params.yarn_orig_ctx = 0;
            ultra_minimal_params.flash_attn = false;
            ultra_minimal_params.n_keep = 0;
            ultra_minimal_params.n_chunks = -1;
            ultra_minimal_params.n_sequences = 1;
            ultra_minimal_params.model_alias = "unknown";

            // Set up signal handler again for ultra-minimal attempt
            if (sigaction(SIGSEGV, &new_action, &old_action) == 0) {
                LOGI("Signal handler reinstalled for ultra-minimal attempt");
            }
            
            try {
                load_success = context->loadModel(ultra_minimal_params);
            } catch (const std::exception& e) {
                LOGE("Exception during ultra-minimal model loading: %s", e.what());
                load_success = false;
            } catch (...) {
                LOGE("Unknown exception during ultra-minimal model loading");
                load_success = false;
            }
            
            // Restore original signal handler
            sigaction(SIGSEGV, &old_action, nullptr);
            
            if (!load_success) {
                LOGE("Model loading failed even with ultra-minimal parameters");
                throw_java_exception(env, "java/lang/RuntimeException", 
                    "Failed to load model - model appears to be corrupted or incompatible with this llama.cpp version. "
                    "Try downloading a fresh copy of the model file.");
                return -1;
            }
        }
        
        LOGI("Model loaded successfully!");
        
        // Store context
        jlong context_id = next_context_id++;
        contexts[context_id] = std::move(context);
        
        LOGI("Initialized context %ld with model: %s", context_id, full_model_path.c_str());
        return context_id;
        
    } catch (const std::exception& e) {
        LOGE("Exception in initContext: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return -1;
    }
}

JNIEXPORT void JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_releaseContextNative(
    JNIEnv* env, jobject thiz, jlong context_id) {
    
    try {
        auto it = contexts.find(context_id);
        if (it != contexts.end()) {
            contexts.erase(it);
            LOGI("Released context %ld", context_id);
        }
    } catch (const std::exception& e) {
        LOGE("Exception in releaseContext: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
    }
}

JNIEXPORT jobject JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_completionNative(
    JNIEnv* env, jobject thiz, jlong context_id, jobject params) {
    
    try {
        LOGI("Starting completion for context: %ld", context_id);
        
        auto it = contexts.find(context_id);
        if (it == contexts.end()) {
            LOGE("Context not found: %ld", context_id);
            throw_java_exception(env, "java/lang/IllegalArgumentException", "Invalid context ID");
            return nullptr;
        }
        
        auto& ctx = it->second;
        if (!ctx || !ctx->ctx) {
            LOGE("Invalid context or llama context is null");
            throw_java_exception(env, "java/lang/RuntimeException", "Invalid context");
            return nullptr;
        }
        
        // Extract parameters from JSObject using compatible API
        jclass jsObjectClass = env->GetObjectClass(params);
        
        // Try to get method IDs and handle exceptions
        jmethodID getStringMethod = nullptr;
        jmethodID getIntegerMethod = nullptr; 
        jmethodID getDoubleMethod = nullptr;
        
        // Clear any pending exceptions first
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
        }
        
        try {
            getStringMethod = env->GetMethodID(jsObjectClass, "getString", "(Ljava/lang/String;)Ljava/lang/String;");
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                getStringMethod = nullptr;
            }
            
            getIntegerMethod = env->GetMethodID(jsObjectClass, "getInteger", "(Ljava/lang/String;)Ljava/lang/Integer;");
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                getIntegerMethod = nullptr;
            }
            
            getDoubleMethod = env->GetMethodID(jsObjectClass, "getDouble", "(Ljava/lang/String;)Ljava/lang/Double;");
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
                getDoubleMethod = nullptr;
            }
        } catch (...) {
            LOGE("Exception getting JSObject method IDs");
            if (env->ExceptionCheck()) {
                env->ExceptionClear();
            }
        }
        
        // Get prompt with safe method calls
        std::string prompt_str = "Once upon a time";
        jint n_predict = 50;
        jdouble temperature = 0.7;
        
        if (getStringMethod) {
            jstring promptKey = jni_utils::string_to_jstring(env, "prompt");
            jstring promptObj = (jstring)env->CallObjectMethod(params, getStringMethod, promptKey);
            if (promptObj && !env->ExceptionCheck()) {
                prompt_str = jni_utils::jstring_to_string(env, promptObj);
            } else if (env->ExceptionCheck()) {
                env->ExceptionClear();
            }
        }
        
        // Get n_predict with safe method calls
        if (getIntegerMethod) {
            jstring nPredictKey = jni_utils::string_to_jstring(env, "n_predict");
            jobject nPredictObj = env->CallObjectMethod(params, getIntegerMethod, nPredictKey);
            if (nPredictObj && !env->ExceptionCheck()) {
                n_predict = env->CallIntMethod(nPredictObj, env->GetMethodID(env->FindClass("java/lang/Integer"), "intValue", "()I"));
                if (env->ExceptionCheck()) {
                    env->ExceptionClear();
                    n_predict = 50; // fallback
                }
            } else if (env->ExceptionCheck()) {
                env->ExceptionClear();
            }
        }
        
        // Get temperature with safe method calls
        if (getDoubleMethod) {
            jstring temperatureKey = jni_utils::string_to_jstring(env, "temperature");
            jobject tempObj = env->CallObjectMethod(params, getDoubleMethod, temperatureKey);
            if (tempObj && !env->ExceptionCheck()) {
                temperature = env->CallDoubleMethod(tempObj, env->GetMethodID(env->FindClass("java/lang/Double"), "doubleValue", "()D"));
                if (env->ExceptionCheck()) {
                    env->ExceptionClear();
                    temperature = 0.7; // fallback
                }
            } else if (env->ExceptionCheck()) {
                env->ExceptionClear();
            }
        }
        
        LOGI("Completion params - prompt: %s, n_predict: %d, temperature: %.2f", 
             prompt_str.c_str(), n_predict, temperature);
        
        // Set sampling parameters based on extracted values
        ctx->params.sampling.temp = temperature;
        ctx->params.sampling.top_k = 40;  // Default value
        ctx->params.sampling.top_p = 0.95f; // Default value
        ctx->params.sampling.penalty_repeat = 1.1f; // Default value (correct field name)
        ctx->params.n_predict = n_predict;
        ctx->params.prompt = prompt_str;
        
        LOGI("Updated context sampling params - temp: %.2f, top_k: %d, top_p: %.2f", 
             ctx->params.sampling.temp, ctx->params.sampling.top_k, ctx->params.sampling.top_p);
        
        // Tokenize the prompt
        capllama::llama_cap_tokenize_result tokenize_result = ctx->tokenize(prompt_str, {});
        std::vector<llama_token> prompt_tokens = tokenize_result.tokens;
        
        LOGI("Tokenized prompt into %zu tokens", prompt_tokens.size());
        
        // Initialize completion context if not already done
        if (!ctx->completion) {
            LOGI("Initializing completion context for the first time");
            
            // Validate parent context before creating completion
            if (!ctx->ctx || !ctx->model) {
                LOGE("Parent context is invalid - missing llama context or model");
                throw_java_exception(env, "java/lang/RuntimeException", "Parent context is not properly initialized");
                return nullptr;
            }
            
            try {
                LOGI("Creating llama_cap_context_completion...");
                LOGI("Parent context pointer: %p", ctx.get());
                LOGI("Parent context->ctx: %p", ctx->ctx);
                LOGI("Parent context->model: %p", ctx->model);
                
                // Additional safety checks before constructor
                if (!ctx.get()) {
                    LOGE("Parent context pointer is null");
                    throw_java_exception(env, "java/lang/RuntimeException", "Parent context pointer is null");
                    return nullptr;
                }
                
                ctx->completion = new capllama::llama_cap_context_completion(ctx.get());
                
                if (!ctx->completion) {
                    LOGE("Failed to create completion context - constructor returned null");
                    throw_java_exception(env, "java/lang/RuntimeException", "Failed to create completion context");
                    return nullptr;
                }
                
                LOGI("Completion context created successfully at: %p", ctx->completion);
                
                LOGI("Initializing sampling for completion context...");
                LOGI("Parent context params before initSampling - model: %p, params: %p", ctx->model, &(ctx->params));
                LOGI("Parent context sampling params - temperature: %.2f, top_k: %d, top_p: %.2f", 
                     ctx->params.sampling.temp, ctx->params.sampling.top_k, ctx->params.sampling.top_p);
                
                bool sampling_result = false;
                try {
                    sampling_result = ctx->completion->initSampling();
                    LOGI("initSampling completed, result: %s", sampling_result ? "true" : "false");
                    LOGI("Sampler pointer after init: %p", ctx->completion->ctx_sampling);
                } catch (const std::exception& e) {
                    LOGE("Exception in initSampling: %s", e.what());
                    delete ctx->completion;
                    ctx->completion = nullptr;
                    throw_java_exception(env, "java/lang/RuntimeException", 
                        ("Failed to initialize sampling: " + std::string(e.what())).c_str());
                    return nullptr;
                } catch (...) {
                    LOGE("Unknown exception in initSampling");
                    delete ctx->completion;
                    ctx->completion = nullptr;
                    throw_java_exception(env, "java/lang/RuntimeException", "Unknown error in sampling initialization");
                    return nullptr;
                }
                
                if (!sampling_result || !ctx->completion->ctx_sampling) {
                    LOGE("Failed to initialize sampling - result: %s, sampler: %p", 
                         sampling_result ? "true" : "false", ctx->completion->ctx_sampling);
                    delete ctx->completion;
                    ctx->completion = nullptr;
                    throw_java_exception(env, "java/lang/RuntimeException", "Failed to initialize sampling context");
                    return nullptr;
                }
                
                LOGI("Completion context initialized successfully");
            } catch (const std::exception& e) {
                LOGE("Exception during completion context creation: %s", e.what());
                if (ctx->completion) {
                    delete ctx->completion;
                    ctx->completion = nullptr;
                }
                throw_java_exception(env, "java/lang/RuntimeException", 
                    ("Failed to create completion context: " + std::string(e.what())).c_str());
                return nullptr;
            } catch (...) {
                LOGE("Unknown exception during completion context creation");
                if (ctx->completion) {
                    delete ctx->completion;
                    ctx->completion = nullptr;
                }
                throw_java_exception(env, "java/lang/RuntimeException", "Unknown error during completion context creation");
                return nullptr;
            }
        }
        
        // Set up sampling parameters
        // Note: For now, we'll use the completion context's default parameters
        // TODO: Update sampling parameters with user values
        // 
            // Declare variables outside try block so they're accessible later
        std::string generated_text;
        int tokens_generated = 0;
        
        try {
            LOGI("Rewinding completion context...");
            try {
                ctx->completion->rewind();
                LOGI("Rewind completed successfully");
            } catch (const std::exception& e) {
                LOGE("Exception in rewind: %s", e.what());
                throw;
            }
            
            LOGI("Loading prompt into completion context...");
            try {
                // Validate sampler is properly initialized before loadPrompt
                if (!ctx->completion->ctx_sampling) {
                    LOGE("Sampler context is null - reinitializing");
                    if (!ctx->completion->initSampling()) {
                        LOGE("Failed to reinitialize sampling");
                        throw std::runtime_error("Sampler initialization failed");
                    }
                    LOGI("Sampler reinitialized successfully");
                }
                
                ctx->completion->loadPrompt({});
                LOGI("loadPrompt completed successfully");
            } catch (const std::exception& e) {
                LOGE("Exception in loadPrompt: %s", e.what());
                throw;
            }
            
            LOGI("Beginning completion generation...");
            try {
                ctx->completion->beginCompletion();
                LOGI("beginCompletion completed successfully");
            } catch (const std::exception& e) {
                LOGE("Exception in beginCompletion: %s", e.what());
                throw;
            }
            
            LOGI("Starting token generation loop (max tokens: %d)...", n_predict);
            
            while (tokens_generated < n_predict && !ctx->completion->is_interrupted) {
                try {
                    LOGI("Generating token %d...", tokens_generated + 1);
                    auto token_output = ctx->completion->nextToken();
                    
                    // Check for end-of-sequence (simplified check)
                    if (token_output.tok == 2) { // Most models use 2 as EOS token
                        LOGI("Reached EOS token, stopping generation");
                        break;
                    }
                    
                    // Convert token to text
                    std::string token_text = capllama::tokens_to_output_formatted_string(ctx->ctx, token_output.tok);
                    generated_text += token_text;
                    tokens_generated++;
                    
                    LOGI("Generated token %d (ID: %d): %s", tokens_generated, token_output.tok, token_text.c_str());
                    
                } catch (const std::exception& e) {
                    LOGE("Exception during token generation %d: %s", tokens_generated + 1, e.what());
                    break;
                } catch (...) {
                    LOGE("Unknown exception during token generation %d", tokens_generated + 1);
                    break;
                }
            }
            
            LOGI("Token generation completed. Generated %d tokens.", tokens_generated);
            
            // End completion
            LOGI("Ending completion...");
            ctx->completion->endCompletion();
            
        } catch (const std::exception& e) {
            LOGE("Exception during completion process: %s", e.what());
            try {
                ctx->completion->endCompletion();
            } catch (...) {
                LOGE("Failed to properly end completion after exception");
            }
            throw_java_exception(env, "java/lang/RuntimeException", 
                ("Completion process failed: " + std::string(e.what())).c_str());
            return nullptr;
        } catch (...) {
            LOGE("Unknown exception during completion process");
            try {
                ctx->completion->endCompletion();
            } catch (...) {
                LOGE("Failed to properly end completion after unknown exception");
            }
            throw_java_exception(env, "java/lang/RuntimeException", "Unknown error during completion process");
            return nullptr;
        }
        
        LOGI("Completion finished. Generated %d tokens: %s", tokens_generated, generated_text.c_str());
        
        // Create result HashMap
        jclass hashMapClass = env->FindClass("java/util/HashMap");
        jmethodID hashMapConstructor = env->GetMethodID(hashMapClass, "<init>", "()V");
        jmethodID putMethod = env->GetMethodID(hashMapClass, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
        
        jobject resultMap = env->NewObject(hashMapClass, hashMapConstructor);
        
        // Add completion results
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "text"), jni_utils::string_to_jstring(env, generated_text));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "content"), jni_utils::string_to_jstring(env, generated_text));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "reasoning_content"), jni_utils::string_to_jstring(env, ""));
        
        // Create empty tool_calls array
        jclass arrayListClass = env->FindClass("java/util/ArrayList");
        jmethodID arrayListConstructor = env->GetMethodID(arrayListClass, "<init>", "()V");
        jobject emptyToolCalls = env->NewObject(arrayListClass, arrayListConstructor);
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "tool_calls"), emptyToolCalls);
        
        // Add token counts and status
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "tokens_predicted"), 
            env->NewObject(env->FindClass("java/lang/Integer"), 
                env->GetMethodID(env->FindClass("java/lang/Integer"), "<init>", "(I)V"), tokens_generated));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "tokens_evaluated"), 
            env->NewObject(env->FindClass("java/lang/Integer"), 
                env->GetMethodID(env->FindClass("java/lang/Integer"), "<init>", "(I)V"), (jint)prompt_tokens.size()));
        
        // Add completion status flags
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "truncated"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), JNI_FALSE));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "stopped_eos"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), 
                tokens_generated < n_predict ? JNI_TRUE : JNI_FALSE));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "stopped_limit"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), 
                tokens_generated >= n_predict ? JNI_TRUE : JNI_FALSE));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "context_full"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), JNI_FALSE));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "interrupted"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), JNI_FALSE));
        
        // Add empty strings for stop reasons
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "stopped_word"), jni_utils::string_to_jstring(env, ""));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "stopping_word"), jni_utils::string_to_jstring(env, ""));
        
        // Add timing information (basic)
        jobject timingsMap = env->NewObject(hashMapClass, hashMapConstructor);
        env->CallObjectMethod(timingsMap, putMethod,
            jni_utils::string_to_jstring(env, "prompt_n"), 
            env->NewObject(env->FindClass("java/lang/Integer"), 
                env->GetMethodID(env->FindClass("java/lang/Integer"), "<init>", "(I)V"), (jint)prompt_tokens.size()));
        env->CallObjectMethod(timingsMap, putMethod,
            jni_utils::string_to_jstring(env, "predicted_n"), 
            env->NewObject(env->FindClass("java/lang/Integer"), 
                env->GetMethodID(env->FindClass("java/lang/Integer"), "<init>", "(I)V"), tokens_generated));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "timings"), timingsMap);
        
        LOGI("Completion result created successfully");
        return resultMap;
        
    } catch (const std::exception& e) {
        LOGE("Exception in completion: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

JNIEXPORT void JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_stopCompletionNative(
    JNIEnv* env, jobject thiz, jlong context_id) {
    
    try {
        auto it = contexts.find(context_id);
        if (it != contexts.end()) {
            // Stop completion logic would go here
            LOGI("Stopped completion for context %ld", context_id);
        }
    } catch (const std::exception& e) {
        LOGE("Exception in stopCompletion: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
    }
}

JNIEXPORT jstring JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_getFormattedChatNative(
    JNIEnv* env, jobject thiz, jlong context_id, jstring messages, jstring chat_template) {
    
    try {
        auto it = contexts.find(context_id);
        if (it == contexts.end()) {
            throw_java_exception(env, "java/lang/IllegalArgumentException", "Invalid context ID");
            return nullptr;
        }
        
        std::string messages_str = jstring_to_string(env, messages);
        std::string template_str = jstring_to_string(env, chat_template);
        
        capllama::llama_cap_context* context = it->second.get();
        
        // Format chat using the context's method
        std::string result = context->getFormattedChat(messages_str, template_str);
        
        LOGI("Formatted chat for context %ld", context_id);
        return string_to_jstring(env, result);
        
    } catch (const std::exception& e) {
        LOGE("Exception in getFormattedChat: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

JNIEXPORT jboolean JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_toggleNativeLogNative(
    JNIEnv* env, jobject thiz, jboolean enabled) {
    
    try {
        // rnllama::rnllama_verbose = jboolean_to_bool(enabled); // This line is removed as per the edit hint
        LOGI("Native logging %s", enabled ? "enabled" : "disabled");
        return bool_to_jboolean(true);
    } catch (const std::exception& e) {
        LOGE("Exception in toggleNativeLog: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return bool_to_jboolean(false);
    }
}

JNIEXPORT jobject JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_modelInfoNative(
    JNIEnv* env, jobject thiz, jstring model_path) {
    
    try {
        std::string model_path_str = jstring_to_string(env, model_path);
        LOGI("Getting model info for: %s", model_path_str.c_str());

        // Extract filename from path
        std::string filename = model_path_str;
        size_t last_slash = model_path_str.find_last_of('/');
        if (last_slash != std::string::npos) {
            filename = model_path_str.substr(last_slash + 1);
        }
        LOGI("Extracted filename for model info: %s", filename.c_str());

        // List all possible paths we should check (same as initContextNative)
        std::vector<std::string> paths_to_check = {
            model_path_str, // Try the original path first
            "/data/data/ai.annadata.llamacpp/files/" + filename,
            "/data/data/ai.annadata.llamacpp/files/Documents/" + filename,
            "/storage/emulated/0/Android/data/ai.annadata.llamacpp/files/" + filename,
            "/storage/emulated/0/Android/data/ai.annadata.llamacpp/files/Documents/" + filename,
            "/storage/emulated/0/Documents/" + filename,
            "/storage/emulated/0/Download/" + filename
        };

        // Check each path and find the actual file
        std::string full_model_path;
        bool file_found = false;
        
        for (const auto& path : paths_to_check) {
            LOGI("Checking path for model info: %s", path.c_str());
            std::ifstream file_check(path, std::ios::binary);
            if (file_check.good()) {
                file_check.seekg(0, std::ios::end);
                std::streamsize file_size = file_check.tellg();
                file_check.seekg(0, std::ios::beg);
                
                // Validate file size
                if (file_size < 1024 * 1024) { // Less than 1MB
                    LOGE("Model file is too small, likely corrupted: %s", path.c_str());
                    file_check.close();
                    continue; // Try next path
                }
                
                // Check if it's a valid GGUF file by reading the magic number
                char magic[4];
                if (file_check.read(magic, 4)) {
                    if (magic[0] == 'G' && magic[1] == 'G' && magic[2] == 'U' && magic[3] == 'F') {
                        LOGI("Valid GGUF file detected for model info at: %s", path.c_str());
                        full_model_path = path;
                        file_found = true;
                        file_check.close();
                        break;
                    } else {
                        LOGI("File does not appear to be a GGUF file (magic: %c%c%c%c) at: %s", 
                             magic[0], magic[1], magic[2], magic[3], path.c_str());
                    }
                }
                file_check.close();
            } else {
                LOGI("File not found at: %s", path.c_str());
            }
        }

        if (!file_found) {
            LOGE("Model file not found in any of the checked paths");
            throw_java_exception(env, "java/lang/RuntimeException", "Model file not found");
            return nullptr;
        }

        // Now use the found path for getting model info
        std::ifstream file_check(full_model_path, std::ios::binary);

        // Get file size
        file_check.seekg(0, std::ios::end);
        std::streamsize file_size = file_check.tellg();
        file_check.seekg(0, std::ios::beg);

        // Check GGUF magic number
        char magic[4];
        if (!file_check.read(magic, 4)) {
            LOGE("Failed to read magic number from: %s", full_model_path.c_str());
            throw_java_exception(env, "java/lang/RuntimeException", "Failed to read model file header");
            return nullptr;
        }

        if (magic[0] != 'G' || magic[1] != 'G' || magic[2] != 'U' || magic[3] != 'F') {
            LOGE("Invalid GGUF file (magic: %c%c%c%c): %s", magic[0], magic[1], magic[2], magic[3], full_model_path.c_str());
            throw_java_exception(env, "java/lang/RuntimeException", "Invalid GGUF file format");
            return nullptr;
        }

        // Read GGUF version
        uint32_t version;
        if (!file_check.read(reinterpret_cast<char*>(&version), sizeof(version))) {
            LOGE("Failed to read GGUF version from: %s", full_model_path.c_str());
            throw_java_exception(env, "java/lang/RuntimeException", "Failed to read GGUF version");
            return nullptr;
        }

        file_check.close();

        // Create Java HashMap
        jclass hashMapClass = env->FindClass("java/util/HashMap");
        jmethodID hashMapConstructor = env->GetMethodID(hashMapClass, "<init>", "()V");
        jmethodID putMethod = env->GetMethodID(hashMapClass, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");

        jobject hashMap = env->NewObject(hashMapClass, hashMapConstructor);

        // Add model info to HashMap
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "path"), 
            string_to_jstring(env, full_model_path));
        
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "size"), 
            env->NewObject(env->FindClass("java/lang/Long"), 
                env->GetMethodID(env->FindClass("java/lang/Long"), "<init>", "(J)V"), 
                static_cast<jlong>(file_size)));
        
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "desc"), 
            string_to_jstring(env, "GGUF Model (v" + std::to_string(version) + ")"));
        
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "nEmbd"), 
            env->NewObject(env->FindClass("java/lang/Integer"), 
                env->GetMethodID(env->FindClass("java/lang/Integer"), "<init>", "(I)V"), 
                0)); // Will be filled by actual model loading
        
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "nParams"), 
            env->NewObject(env->FindClass("java/lang/Integer"), 
                env->GetMethodID(env->FindClass("java/lang/Integer"), "<init>", "(I)V"), 
                0)); // Will be filled by actual model loading

        LOGI("Model info retrieved successfully from %s: size=%ld, version=%u", full_model_path.c_str(), file_size, version);
        return hashMap;

    } catch (const std::exception& e) {
        LOGE("Exception in modelInfo: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}



JNIEXPORT jstring JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_downloadModelNative(
    JNIEnv* env, jobject thiz, jstring url, jstring filename) {
    
    try {
        std::string url_str = jstring_to_string(env, url);
        std::string filename_str = jstring_to_string(env, filename);
        
        LOGI("Preparing download path for model: %s", filename_str.c_str());
        
        // Determine local storage path (use external storage for large files)
        std::string local_path = "/storage/emulated/0/Android/data/ai.annadata.llamacpp/files/Models/" + filename_str;
        
        // Create directory if it doesn't exist
        std::string dir_path = "/storage/emulated/0/Android/data/ai.annadata.llamacpp/files/Models/";
        std::filesystem::create_directories(dir_path);
        
        LOGI("Download path prepared: %s", local_path.c_str());
        
        return string_to_jstring(env, local_path);
        
    } catch (const std::exception& e) {
        LOGE("Exception in downloadModel: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

JNIEXPORT jobject JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_getDownloadProgressNative(
    JNIEnv* env, jobject thiz, jstring url) {
    
    try {
        // For now, return a placeholder since we'll handle download in Java
        // This can be enhanced later to track actual download progress
        
        jclass hashMapClass = env->FindClass("java/util/HashMap");
        jmethodID hashMapConstructor = env->GetMethodID(hashMapClass, "<init>", "()V");
        jmethodID putMethod = env->GetMethodID(hashMapClass, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
        
        jobject hashMap = env->NewObject(hashMapClass, hashMapConstructor);
        
        // Return placeholder progress info
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "progress"), 
            env->NewObject(env->FindClass("java/lang/Double"), 
                env->GetMethodID(env->FindClass("java/lang/Double"), "<init>", "(D)V"), 
                0.0));
        
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "completed"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), 
                false));
        
        env->CallObjectMethod(hashMap, putMethod, 
            string_to_jstring(env, "failed"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), 
                false));
        
        return hashMap;
        
    } catch (const std::exception& e) {
        LOGE("Exception in getDownloadProgress: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

JNIEXPORT jboolean JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_cancelDownloadNative(
    JNIEnv* env, jobject thiz, jstring url) {
    
    try {
        // For now, return false since we'll handle download cancellation in Java
        // This can be enhanced later to actually cancel downloads
        return JNI_FALSE;
        
    } catch (const std::exception& e) {
        LOGE("Exception in cancelDownload: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return JNI_FALSE;
    }
}

JNIEXPORT jobject JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_getAvailableModelsNative(
    JNIEnv* env, jobject thiz) {
    
    try {
        std::string models_dir = "/storage/emulated/0/Android/data/ai.annadata.llamacpp/files/Models/";
        
        // Create Java ArrayList
        jclass arrayListClass = env->FindClass("java/util/ArrayList");
        jmethodID arrayListConstructor = env->GetMethodID(arrayListClass, "<init>", "()V");
        jmethodID addMethod = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");
        
        jobject arrayList = env->NewObject(arrayListClass, arrayListConstructor);
        
        if (std::filesystem::exists(models_dir)) {
            for (const auto& entry : std::filesystem::directory_iterator(models_dir)) {
                if (entry.is_regular_file() && entry.path().extension() == ".gguf") {
                    std::string filename = entry.path().filename().string();
                    std::string full_path = entry.path().string();
                    size_t file_size = entry.file_size();
                    
                    // Create model info HashMap
                    jclass hashMapClass = env->FindClass("java/util/HashMap");
                    jmethodID hashMapConstructor = env->GetMethodID(hashMapClass, "<init>", "()V");
                    jmethodID putMethod = env->GetMethodID(hashMapClass, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
                    
                    jobject modelInfo = env->NewObject(hashMapClass, hashMapConstructor);
                    
                    env->CallObjectMethod(modelInfo, putMethod, 
                        string_to_jstring(env, "name"), 
                        string_to_jstring(env, filename));
                    
                    env->CallObjectMethod(modelInfo, putMethod, 
                        string_to_jstring(env, "path"), 
                        string_to_jstring(env, full_path));
                    
                    env->CallObjectMethod(modelInfo, putMethod, 
                        string_to_jstring(env, "size"), 
                        env->NewObject(env->FindClass("java/lang/Long"), 
                            env->GetMethodID(env->FindClass("java/lang/Long"), "<init>", "(J)V"), 
                            static_cast<jlong>(file_size)));
                    
                    // Add to ArrayList
                    env->CallBooleanMethod(arrayList, addMethod, modelInfo);
                }
            }
        }
        
        return arrayList;
        
    } catch (const std::exception& e) {
        LOGE("Exception in getAvailableModels: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

// MARK: - Tokenization methods

JNIEXPORT jobject JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_tokenizeNative(
    JNIEnv* env, jobject thiz, jlong contextId, jstring text, jobjectArray imagePaths) {
    
    try {
        LOGI("Tokenizing with context ID: %ld", contextId);
        
        std::string text_str = jni_utils::jstring_to_string(env, text);
        LOGI("Text to tokenize: %s", text_str.c_str());
        
        // Find the context
        auto it = contexts.find(contextId);
        if (it == contexts.end()) {
            LOGE("Context not found: %ld", contextId);
            throw_java_exception(env, "java/lang/RuntimeException", "Context not found");
            return nullptr;
        }
        
        auto& ctx = it->second;
        if (!ctx || !ctx->ctx) {
            LOGE("Invalid context or llama context is null");
            throw_java_exception(env, "java/lang/RuntimeException", "Invalid context");
            return nullptr;
        }
        
        // Tokenize the text using the context's tokenize method
        capllama::llama_cap_tokenize_result tokenize_result = ctx->tokenize(text_str, {});
        std::vector<llama_token> tokens = tokenize_result.tokens;
        
        LOGI("Tokenized %zu tokens", tokens.size());
        
        // Create Java HashMap for result
        jclass hashMapClass = env->FindClass("java/util/HashMap");
        jmethodID hashMapConstructor = env->GetMethodID(hashMapClass, "<init>", "()V");
        jmethodID putMethod = env->GetMethodID(hashMapClass, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
        
        jobject resultMap = env->NewObject(hashMapClass, hashMapConstructor);
        
        // Create Java ArrayList for tokens
        jclass arrayListClass = env->FindClass("java/util/ArrayList");
        jmethodID arrayListConstructor = env->GetMethodID(arrayListClass, "<init>", "()V");
        jmethodID addMethod = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");
        
        jobject tokensArray = env->NewObject(arrayListClass, arrayListConstructor);
        
        // Add tokens to ArrayList
        jclass integerClass = env->FindClass("java/lang/Integer");
        jmethodID integerConstructor = env->GetMethodID(integerClass, "<init>", "(I)V");
        
        for (llama_token token : tokens) {
            jobject jToken = env->NewObject(integerClass, integerConstructor, static_cast<jint>(token));
            env->CallBooleanMethod(tokensArray, addMethod, jToken);
            env->DeleteLocalRef(jToken);
        }
        
        // Create empty arrays for other fields
        jobject emptyBitmapHashes = env->NewObject(arrayListClass, arrayListConstructor);
        jobject emptyChunkPos = env->NewObject(arrayListClass, arrayListConstructor);
        jobject emptyChunkPosImages = env->NewObject(arrayListClass, arrayListConstructor);
        
        // Put all data into result map
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "tokens"), tokensArray);
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "has_images"), 
            env->NewObject(env->FindClass("java/lang/Boolean"), 
                env->GetMethodID(env->FindClass("java/lang/Boolean"), "<init>", "(Z)V"), JNI_FALSE));
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "bitmap_hashes"), emptyBitmapHashes);
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "chunk_pos"), emptyChunkPos);
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "chunk_pos_images"), emptyChunkPosImages);
        
        LOGI("Tokenization completed successfully");
        return resultMap;
        
    } catch (const std::exception& e) {
        LOGE("Exception in tokenize: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

JNIEXPORT jstring JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_detokenizeNative(
    JNIEnv* env, jobject thiz, jlong contextId, jintArray tokens) {
    
    try {
        LOGI("Detokenizing with context ID: %ld", contextId);
        
        // Find the context
        auto it = contexts.find(contextId);
        if (it == contexts.end()) {
            LOGE("Context not found: %ld", contextId);
            throw_java_exception(env, "java/lang/RuntimeException", "Context not found");
            return nullptr;
        }
        
        auto& ctx = it->second;
        if (!ctx || !ctx->ctx) {
            LOGE("Invalid context or llama context is null");
            throw_java_exception(env, "java/lang/RuntimeException", "Invalid context");
            return nullptr;
        }
        
        // Convert Java int array to C++ vector
        jsize length = env->GetArrayLength(tokens);
        jint* tokenArray = env->GetIntArrayElements(tokens, nullptr);
        
        std::vector<llama_token> llamaTokens;
        for (jsize i = 0; i < length; i++) {
            llamaTokens.push_back(static_cast<llama_token>(tokenArray[i]));
        }
        
        env->ReleaseIntArrayElements(tokens, tokenArray, JNI_ABORT);
        
        // Detokenize using llama.cpp
        std::string result = capllama::tokens_to_str(ctx->ctx, llamaTokens.begin(), llamaTokens.end());
        
        LOGI("Detokenized to: %s", result.c_str());
        
        return jni_utils::string_to_jstring(env, result);
        
    } catch (const std::exception& e) {
        LOGE("Exception in detokenize: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

// MARK: - Embedding methods

JNIEXPORT jobject JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_embeddingNative(
    JNIEnv* env, jobject thiz, jlong contextId, jstring text, jobject params) {
    
    try {
        LOGI("Generating embeddings for context ID: %ld", contextId);
        
        std::string text_str = jni_utils::jstring_to_string(env, text);
        LOGI("Text to embed: %s", text_str.substr(0, std::min(50, (int)text_str.length())).c_str());
        
        // Find the context
        auto it = contexts.find(contextId);
        if (it == contexts.end()) {
            LOGE("Context not found: %ld", contextId);
            throw_java_exception(env, "java/lang/RuntimeException", "Context not found");
            return nullptr;
        }
        
        auto& ctx = it->second;
        if (!ctx || !ctx->ctx || !ctx->model) {
            LOGE("Invalid context, llama context, or model is null");
            throw_java_exception(env, "java/lang/RuntimeException", "Invalid context or model not loaded");
            return nullptr;
        }
        
        // Get embedding dimension from model
        int32_t n_embd = llama_model_n_embd(ctx->model);
        if (n_embd <= 0) {
            LOGE("Model does not support embeddings (n_embd = %d)", n_embd);
            throw_java_exception(env, "java/lang/RuntimeException", "Model does not support embeddings");
            return nullptr;
        }
        
        LOGI("Model embedding dimension: %d", n_embd);
        
        // CRITICAL FIX: Check if model was initialized with embedding support
        // If embedding was not enabled during init, llama_set_embeddings() may not work properly
        // and will return [0.0, 0.0...] embeddings. We need to check and warn the user.
        bool embedding_was_enabled = ctx->params.embedding;
        if (!embedding_was_enabled) {
            LOGI("WARNING: Model was not initialized with embedding: true. Attempting to enable dynamically...");
            LOGI("Note: If embeddings return zeros, the model must be re-initialized with embedding: true");
        }
        
        // Extract parameters from JSObject (optional: embd_normalize, n_batch, n_threads)
        double embd_normalize = 1.0;
        int32_t n_batch = 512;
        int32_t n_threads = ctx->params.cpuparams.n_threads;
        if (n_threads < 1) {
            n_threads = llama_n_threads_batch(ctx->ctx);
        }
        
        // Try to extract parameters from JSObject if provided
        if (params != nullptr) {
            jclass jsObjectClass = env->GetObjectClass(params);
            if (jsObjectClass != nullptr && !env->ExceptionCheck()) {
                // Try to get embd_normalize
                jmethodID getDoubleMethod = env->GetMethodID(jsObjectClass, "getDouble", "(Ljava/lang/String;)Ljava/lang/Double;");
                if (getDoubleMethod != nullptr && !env->ExceptionCheck()) {
                    jstring normalizeKey = jni_utils::string_to_jstring(env, "embd_normalize");
                    jobject normalizeObj = env->CallObjectMethod(params, getDoubleMethod, normalizeKey);
                    if (normalizeObj != nullptr && !env->ExceptionCheck()) {
                        embd_normalize = env->CallDoubleMethod(normalizeObj, 
                            env->GetMethodID(env->FindClass("java/lang/Double"), "doubleValue", "()D"));
                        env->DeleteLocalRef(normalizeObj);
                    }
                    env->DeleteLocalRef(normalizeKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                }
            }
        }
        
        // Tokenize the input text
        capllama::llama_cap_tokenize_result tokenize_result = ctx->tokenize(text_str, {});
        std::vector<llama_token> tokens = tokenize_result.tokens;
        
        if (tokens.empty()) {
            LOGE("Tokenization resulted in empty token list");
            throw_java_exception(env, "java/lang/RuntimeException", "Failed to tokenize input text");
            return nullptr;
        }
        
        LOGI("Tokenized into %zu tokens", tokens.size());
        
        // Enable embeddings in the context
        llama_set_embeddings(ctx->ctx, true);
        
        // Create a batch for embedding extraction
        llama_batch batch = llama_batch_init(tokens.size(), 0, 1);
        
        // Add tokens to batch with embeddings enabled
        for (size_t i = 0; i < tokens.size(); i++) {
            capllama::llama_batch_add(&batch, tokens[i], i, {0}, true); // logits=true to get embeddings
        }
        
        // Decode the batch to get embeddings
        int decode_result = llama_decode(ctx->ctx, batch);
        if (decode_result != 0) {
            LOGE("llama_decode failed with code: %d", decode_result);
            llama_batch_free(batch);
            throw_java_exception(env, "java/lang/RuntimeException", "Failed to decode tokens for embeddings");
            return nullptr;
        }
        
        // Get embeddings from the context
        // For generative models, we typically want the last token's embedding or mean pooling
        float* embeddings_ptr = llama_get_embeddings(ctx->ctx);
        if (embeddings_ptr == nullptr) {
            LOGE("llama_get_embeddings returned null");
            llama_batch_free(batch);
            throw_java_exception(env, "java/lang/RuntimeException", "Failed to extract embeddings");
            return nullptr;
        }
        
        // For multiple tokens, we'll use mean pooling (average of all token embeddings)
        // This is a common approach for text embeddings
        std::vector<float> embedding_vector(n_embd, 0.0f);
        
        // Count how many tokens have embeddings (logits != 0)
        int n_outputs = 0;
        for (int i = 0; i < batch.n_tokens; i++) {
            if (batch.logits[i] != 0) {
                n_outputs++;
            }
        }
        
        if (n_outputs > 0) {
            // Mean pooling: sum all token embeddings, then divide by count
            for (int i = 0; i < n_outputs; i++) {
                float* token_embd = embeddings_ptr + (i * n_embd);
                for (int j = 0; j < n_embd; j++) {
                    embedding_vector[j] += token_embd[j];
                }
            }
            
            // Divide by number of outputs to get mean
            for (int j = 0; j < n_embd; j++) {
                embedding_vector[j] /= n_outputs;
            }
        } else {
            // Fallback: use the last token's embedding if available
            float* last_embd = llama_get_embeddings_ith(ctx->ctx, -1);
            if (last_embd != nullptr) {
                std::memcpy(embedding_vector.data(), last_embd, n_embd * sizeof(float));
            } else {
                LOGE("No embeddings available");
                llama_batch_free(batch);
                throw_java_exception(env, "java/lang/RuntimeException", "No embeddings available");
                return nullptr;
            }
        }
        
        // Apply normalization if specified
        if (embd_normalize != 1.0 && embd_normalize != 0.0) {
            float norm = 0.0f;
            for (int i = 0; i < n_embd; i++) {
                norm += embedding_vector[i] * embedding_vector[i];
            }
            norm = std::sqrt(norm);
            if (norm > 0.0f) {
                float scale = static_cast<float>(embd_normalize) / norm;
                for (int i = 0; i < n_embd; i++) {
                    embedding_vector[i] *= scale;
                }
            }
        }
        
        // Clean up batch
        llama_batch_free(batch);
        
        // Disable embeddings to restore normal operation
        llama_set_embeddings(ctx->ctx, false);
        
        LOGI("Embedding generated successfully, dimension: %d", n_embd);
        
        // Create Java HashMap for result
        jclass hashMapClass = env->FindClass("java/util/HashMap");
        jmethodID hashMapConstructor = env->GetMethodID(hashMapClass, "<init>", "()V");
        jmethodID putMethod = env->GetMethodID(hashMapClass, "put", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
        
        jobject resultMap = env->NewObject(hashMapClass, hashMapConstructor);
        
        // Create Java ArrayList for embedding vector
        jclass arrayListClass = env->FindClass("java/util/ArrayList");
        jmethodID arrayListConstructor = env->GetMethodID(arrayListClass, "<init>", "()V");
        jmethodID addMethod = env->GetMethodID(arrayListClass, "add", "(Ljava/lang/Object;)Z");
        
        jobject embeddingArray = env->NewObject(arrayListClass, arrayListConstructor);
        
        // Add embedding values to ArrayList as Doubles
        jclass doubleClass = env->FindClass("java/lang/Double");
        jmethodID doubleConstructor = env->GetMethodID(doubleClass, "<init>", "(D)V");
        
        for (int i = 0; i < n_embd; i++) {
            jobject jValue = env->NewObject(doubleClass, doubleConstructor, static_cast<jdouble>(embedding_vector[i]));
            env->CallBooleanMethod(embeddingArray, addMethod, jValue);
            env->DeleteLocalRef(jValue);
        }
        
        // Put embedding array and dimension into result map
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "embedding"), embeddingArray);
        env->CallObjectMethod(resultMap, putMethod,
            jni_utils::string_to_jstring(env, "n_embd"), 
            env->NewObject(env->FindClass("java/lang/Integer"), 
                env->GetMethodID(env->FindClass("java/lang/Integer"), "<init>", "(I)V"), n_embd));
        
        LOGI("Embedding result created successfully");
        return resultMap;
        
    } catch (const std::exception& e) {
        LOGE("Exception in embedding: %s", e.what());
        throw_java_exception(env, "java/lang/RuntimeException", e.what());
        return nullptr;
    }
}

} // extern "C"

} // namespace jni_utils
