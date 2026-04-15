cmake_minimum_required(VERSION 3.16)
project(llama-cpp VERSION 1.0.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# iOS specific settings for ARM64 devices
set(CMAKE_OSX_DEPLOYMENT_TARGET 13.0)
set(CMAKE_XCODE_ATTRIBUTE_ENABLE_BITCODE NO)

# Common llama.cpp definitions
add_definitions(
    -DNDEBUG
    -DO3
    -DLM_GGML_USE_CPU
    -DLM_GGML_USE_ACCELERATE
    -DLM_GGML_USE_METAL
    -DLM_GGML_METAL_USE_BF16
)

set(SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../cpp)

# ARM64‑tuned ggml sources
set(SOURCE_FILES_ARCH
    ${SOURCE_DIR}/ggml-cpu/arch/arm/quants.c
    ${SOURCE_DIR}/ggml-cpu/arch/arm/repack.cpp
)

# Define public headers
set(PUBLIC_HEADERS
    ${SOURCE_DIR}/cap-llama.h
    ${SOURCE_DIR}/cap-completion.h
    ${SOURCE_DIR}/cap-tts.h
    ${SOURCE_DIR}/llama.h
    ${SOURCE_DIR}/ggml.h
)

# Create library target
add_library(llama-cpp SHARED
    ${SOURCE_DIR}/ggml.c
    ${SOURCE_DIR}/ggml-alloc.c
    ${SOURCE_DIR}/ggml-backend.cpp
    ${SOURCE_DIR}/ggml-backend-reg.cpp
    ${SOURCE_DIR}/ggml-cpu/amx/amx.cpp
    ${SOURCE_DIR}/ggml-cpu/amx/mmq.cpp
    ${SOURCE_DIR}/ggml-cpu/ggml-cpu.c
    ${SOURCE_DIR}/ggml-cpu/ggml-cpu.cpp
    ${SOURCE_DIR}/ggml-cpu/quants.c
    ${SOURCE_DIR}/ggml-cpu/traits.cpp
    ${SOURCE_DIR}/ggml-cpu/repack.cpp
    ${SOURCE_DIR}/ggml-cpu/unary-ops.cpp
    ${SOURCE_DIR}/ggml-cpu/binary-ops.cpp
    ${SOURCE_DIR}/ggml-cpu/vec.cpp
    ${SOURCE_DIR}/ggml-cpu/ops.cpp
    ${SOURCE_DIR}/ggml-metal.m
    ${SOURCE_DIR}/ggml-opt.cpp
    ${SOURCE_DIR}/ggml-threading.cpp
    ${SOURCE_DIR}/ggml-quants.c
    ${SOURCE_DIR}/gguf.cpp
    ${SOURCE_DIR}/log.cpp
    ${SOURCE_DIR}/llama-impl.cpp
    ${SOURCE_DIR}/llama-grammar.cpp
    ${SOURCE_DIR}/llama-sampling.cpp
    ${SOURCE_DIR}/llama-vocab.cpp
    ${SOURCE_DIR}/llama-adapter.cpp
    ${SOURCE_DIR}/llama-chat.cpp
    ${SOURCE_DIR}/llama-context.cpp
    ${SOURCE_DIR}/llama-arch.cpp
    ${SOURCE_DIR}/llama-batch.cpp
    ${SOURCE_DIR}/llama-cparams.cpp
    ${SOURCE_DIR}/llama-hparams.cpp
    ${SOURCE_DIR}/llama.cpp
    ${SOURCE_DIR}/llama-model.cpp
    ${SOURCE_DIR}/llama-model-loader.cpp
    ${SOURCE_DIR}/llama-model-saver.cpp
    ${SOURCE_DIR}/llama-mmap.cpp
    ${SOURCE_DIR}/llama-kv-cache.cpp
    ${SOURCE_DIR}/llama-kv-cache-iswa.cpp
    ${SOURCE_DIR}/llama-memory-hybrid.cpp
    ${SOURCE_DIR}/llama-memory-recurrent.cpp
    ${SOURCE_DIR}/llama-memory.cpp
    ${SOURCE_DIR}/llama-io.cpp
    ${SOURCE_DIR}/llama-graph.cpp
    ${SOURCE_DIR}/sampling.cpp
    ${SOURCE_DIR}/unicode-data.cpp
    ${SOURCE_DIR}/unicode.cpp
    ${SOURCE_DIR}/common.cpp
    ${SOURCE_DIR}/chat.cpp
    # Additional sources required for JSON parsing, chat parser, and mtmd tools
    ${SOURCE_DIR}/chat-parser.cpp
    ${SOURCE_DIR}/regex-partial.cpp
    ${SOURCE_DIR}/json-partial.cpp
    ${SOURCE_DIR}/json-schema-to-grammar.cpp
    ${SOURCE_DIR}/anyascii.c
    ${SOURCE_DIR}/tools/mtmd/mtmd.cpp
    ${SOURCE_DIR}/tools/mtmd/mtmd-helper.cpp
    ${SOURCE_DIR}/tools/mtmd/mtmd-audio.cpp
    ${SOURCE_DIR}/tools/mtmd/clip.cpp
    ${SOURCE_DIR}/cap-llama.cpp
    ${SOURCE_DIR}/cap-completion.cpp
    ${SOURCE_DIR}/cap-tts.cpp
    ${SOURCE_DIR}/cap-embedding.cpp
    ${SOURCE_DIR}/cap-ios-bridge.cpp
    ${SOURCE_DIR}/cap-native-server.cpp
    ${SOURCE_DIR}/vendor/cpp-httplib/httplib.cpp
    ${SOURCE_FILES_ARCH}
)

# Set target properties
set_target_properties(llama-cpp PROPERTIES
    FRAMEWORK TRUE
    FRAMEWORK_VERSION A
    MACOSX_FRAMEWORK_IDENTIFIER com.arusatech.llama-cpp
    MACOSX_FRAMEWORK_BUNDLE_VERSION 1.0.0
    MACOSX_FRAMEWORK_SHORT_VERSION_STRING 1.0.0
    XCODE_ATTRIBUTE_CODE_SIGN_IDENTITY "iPhone Developer"
    XCODE_ATTRIBUTE_DEVELOPMENT_TEAM ""
    XCODE_ATTRIBUTE_ONLY_ACTIVE_ARCH NO
    XCODE_ATTRIBUTE_ENABLE_BITCODE NO
)

# Include directories
target_include_directories(llama-cpp PRIVATE
    ${SOURCE_DIR}
    ${SOURCE_DIR}/ggml-cpu
    ${SOURCE_DIR}/tools/mtmd
    ${SOURCE_DIR}/vendor/cpp-httplib
)

# ARM64: rely on Clang's default tuning; no x86‑specific -march flags here

# Link frameworks via linker flags
target_link_options(llama-cpp PRIVATE
    "-Wl,-framework,Accelerate"
    "-Wl,-framework,Metal"
    "-Wl,-framework,MetalKit"
    "-Wl,-framework,Foundation"
    "-Wl,-framework,CoreGraphics"
)

# Public headers
set_target_properties(llama-cpp PROPERTIES
    PUBLIC_HEADER "${PUBLIC_HEADERS}"
)

# Install rules
install(TARGETS llama-cpp
    FRAMEWORK DESTINATION .
)

message(STATUS "Building llama-cpp for ARM64 (devices)")
message(STATUS "Source directory: ${SOURCE_DIR}")
message(STATUS "Architecture: arm64")

