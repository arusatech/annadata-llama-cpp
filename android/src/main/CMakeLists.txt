cmake_minimum_required(VERSION 3.10)

project(llama-cpp)

set(CMAKE_CXX_STANDARD 17)
set(LLAMACPP_LIB_DIR ${CMAKE_SOURCE_DIR}/../../../cpp)

include_directories(
    ${LLAMACPP_LIB_DIR}
    ${LLAMACPP_LIB_DIR}/ggml-cpu
    ${LLAMACPP_LIB_DIR}/tools/mtmd
    ${LLAMACPP_LIB_DIR}/vendor/cpp-httplib
)

set(
    SOURCE_FILES
    ${LLAMACPP_LIB_DIR}/ggml.c
    ${LLAMACPP_LIB_DIR}/ggml-alloc.c
    ${LLAMACPP_LIB_DIR}/ggml-backend.cpp
    ${LLAMACPP_LIB_DIR}/ggml-backend-reg.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/amx/amx.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/amx/mmq.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/ggml-cpu.c
    ${LLAMACPP_LIB_DIR}/ggml-cpu/ggml-cpu.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/quants.c
    ${LLAMACPP_LIB_DIR}/ggml-cpu/traits.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/repack.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/unary-ops.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/binary-ops.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/vec.cpp
    ${LLAMACPP_LIB_DIR}/ggml-cpu/ops.cpp
    ${LLAMACPP_LIB_DIR}/ggml-opt.cpp
    ${LLAMACPP_LIB_DIR}/ggml-threading.cpp
    ${LLAMACPP_LIB_DIR}/ggml-quants.c
    ${LLAMACPP_LIB_DIR}/gguf.cpp
    ${LLAMACPP_LIB_DIR}/log.cpp
    ${LLAMACPP_LIB_DIR}/llama-impl.cpp
    ${LLAMACPP_LIB_DIR}/chat-parser.cpp
    ${LLAMACPP_LIB_DIR}/json-partial.cpp
    ${LLAMACPP_LIB_DIR}/regex-partial.cpp
    # Multimodal support
    ${LLAMACPP_LIB_DIR}/tools/mtmd/mtmd.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/mtmd-audio.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/clip.cpp
    ${LLAMACPP_LIB_DIR}/tools/mtmd/mtmd-helper.cpp
    ${LLAMACPP_LIB_DIR}/llama-grammar.cpp
    ${LLAMACPP_LIB_DIR}/llama-sampling.cpp
    ${LLAMACPP_LIB_DIR}/llama-vocab.cpp
    ${LLAMACPP_LIB_DIR}/llama-adapter.cpp
    ${LLAMACPP_LIB_DIR}/llama-chat.cpp
    ${LLAMACPP_LIB_DIR}/llama-context.cpp
    ${LLAMACPP_LIB_DIR}/llama-arch.cpp
    ${LLAMACPP_LIB_DIR}/llama-batch.cpp
    ${LLAMACPP_LIB_DIR}/llama-cparams.cpp
    ${LLAMACPP_LIB_DIR}/llama-hparams.cpp
    ${LLAMACPP_LIB_DIR}/llama.cpp
    ${LLAMACPP_LIB_DIR}/llama-model.cpp
    ${LLAMACPP_LIB_DIR}/llama-model-loader.cpp
    ${LLAMACPP_LIB_DIR}/llama-model-saver.cpp
    ${LLAMACPP_LIB_DIR}/llama-kv-cache.cpp
    ${LLAMACPP_LIB_DIR}/llama-kv-cache-iswa.cpp
    ${LLAMACPP_LIB_DIR}/llama-memory-hybrid.cpp
    ${LLAMACPP_LIB_DIR}/llama-memory-recurrent.cpp
    ${LLAMACPP_LIB_DIR}/llama-mmap.cpp
    ${LLAMACPP_LIB_DIR}/llama-vocab.cpp
    ${LLAMACPP_LIB_DIR}/llama-memory.cpp
    ${LLAMACPP_LIB_DIR}/llama-io.cpp
    ${LLAMACPP_LIB_DIR}/llama-graph.cpp
    ${LLAMACPP_LIB_DIR}/sampling.cpp
    ${LLAMACPP_LIB_DIR}/unicode-data.cpp
    ${LLAMACPP_LIB_DIR}/unicode.cpp
    ${LLAMACPP_LIB_DIR}/common.cpp
    ${LLAMACPP_LIB_DIR}/chat.cpp
    ${LLAMACPP_LIB_DIR}/json-schema-to-grammar.cpp
    ${LLAMACPP_LIB_DIR}/nlohmann/json.hpp
    ${LLAMACPP_LIB_DIR}/nlohmann/json_fwd.hpp
    ${LLAMACPP_LIB_DIR}/minja/minja.hpp
    ${LLAMACPP_LIB_DIR}/minja/chat-template.hpp
    ${LLAMACPP_LIB_DIR}/anyascii.c
    ${LLAMACPP_LIB_DIR}/cap-llama.cpp
    ${LLAMACPP_LIB_DIR}/cap-completion.cpp
    ${LLAMACPP_LIB_DIR}/cap-tts.cpp
    ${LLAMACPP_LIB_DIR}/cap-ios-bridge.cpp
    ${LLAMACPP_LIB_DIR}/cap-embedding.cpp
    ${LLAMACPP_LIB_DIR}/cap-native-server.cpp
    ${LLAMACPP_LIB_DIR}/vendor/cpp-httplib/httplib.cpp
    ${CMAKE_SOURCE_DIR}/jni-utils.h
    ${CMAKE_SOURCE_DIR}/jni.cpp
)

# Find Android libraries
find_library(LOG_LIB log)
find_library(ANDROID_LIB android)
find_package(Threads REQUIRED)

# ARM64 specific build function for real devices
function(build_library_arm64 target_name)
    add_library(
        ${target_name}
        SHARED
        ${SOURCE_FILES}
    )

    # ARM64 specific compile options for real devices
    target_compile_options(${target_name} PRIVATE
        -march=armv8-a
        -mtune=cortex-a76
        -O3
        -DNDEBUG
        -DLM_GGML_USE_CPU
        -DLM_GGML_CPU_GENERIC
        -fno-finite-math-only
        -funroll-loops
    )

    # Link with Android libraries
    target_link_libraries(${target_name} 
        ${LOG_LIB}
        ${ANDROID_LIB}
        Threads::Threads
    )
    
    # Set output name and directory
    set_target_properties(${target_name} PROPERTIES
        OUTPUT_NAME "llama-cpp-arm64"
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/jniLibs/arm64-v8a"
    )
endfunction()

# Build ARM64 library for real devices
build_library_arm64(llama-cpp-arm64)

# Print build information
message(STATUS "Building llama-cpp for Android ARM64 (real devices)")
message(STATUS "Source directory: ${LLAMACPP_LIB_DIR}")
message(STATUS "Architecture: ARM64 (arm64-v8a)")
message(STATUS "Optimizations: ARMv8-A, Cortex-A76 tuning")
message(STATUS "Output directory: ${CMAKE_CURRENT_SOURCE_DIR}/jniLibs/arm64-v8a")
