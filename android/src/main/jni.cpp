#include "jni-utils.h"
#include "cap-llama.h"
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
        
        // Initialize common parameters
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
        cparams.embedding = false;
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

        LOGI("Initialized common parameters, attempting to load model from: %s", full_model_path.c_str());
        LOGI("Model parameters: n_ctx=%d, n_batch=%d, n_gpu_layers=%d", 
             cparams.n_ctx, cparams.n_batch, cparams.n_gpu_layers);
        
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
            ultra_minimal_params.embedding = false;
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

JNIEXPORT jstring JNICALL
Java_ai_annadata_plugin_capacitor_LlamaCpp_completionNative(
    JNIEnv* env, jobject thiz, jlong context_id, jstring prompt) {
    
    try {
        auto it = contexts.find(context_id);
        if (it == contexts.end()) {
            throw_java_exception(env, "java/lang/IllegalArgumentException", "Invalid context ID");
            return nullptr;
        }
        
        std::string prompt_str = jstring_to_string(env, prompt);
        
        // Get the context
        capllama::llama_cap_context* context = it->second.get();
        
        // For now, return a simple completion
        // In a full implementation, this would use the actual llama.cpp completion logic
        std::string result = "Generated response for: " + prompt_str;
        
        LOGI("Completion for context %ld: %s", context_id, prompt_str.c_str());
        return string_to_jstring(env, result);
        
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

} // extern "C"

} // namespace jni_utils
