cmake_minimum_required(VERSION 3.18.1)
project("llama-cpp")

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Set architecture-specific flags correctly
if(${ANDROID_ABI} STREQUAL "arm64-v8a")
    # Fix: Separate -march and -mtune flags
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=armv8-a -mtune=cortex-a76")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=armv8-a -mtune=cortex-a76")
    add_definitions(-D__ARM_ARCH_8A__ -D__ARM_NEON)
elseif(${ANDROID_ABI} STREQUAL "armeabi-v7a")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=armv7-a -mfpu=neon -mfloat-abi=softfp")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=armv7-a -mfpu=neon -mfloat-abi=softfp")
    add_definitions(-D__ARM_ARCH_7A__ -D__ARM_NEON)
elseif(${ANDROID_ABI} STREQUAL "x86")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=i686 -mtune=intel -mssse3 -mfpmath=sse")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=i686 -mtune=intel -mssse3 -mfpmath=sse")
elseif(${ANDROID_ABI} STREQUAL "x86_64")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=x86-64 -mtune=intel -msse4.2 -mpopcnt")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -march=x86-64 -mtune=intel -msse4.2 -mpopcnt")
endif()

# Add optimization flags
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -O3 -DNDEBUG -DLM_GGML_USE_CPU -DLM_GGML_CPU_GENERIC -fno-finite-math-only -funroll-loops")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -O3 -DNDEBUG -DLM_GGML_USE_CPU -DLM_GGML_CPU_GENERIC -fno-finite-math-only -funroll-loops")

# Include directories
include_directories(
    ${CMAKE_SOURCE_DIR}/../../../cpp
    ${CMAKE_SOURCE_DIR}/../../../cpp/ggml-cpu
    ${CMAKE_SOURCE_DIR}/../../../cpp/tools/mtmd
)

# Source files - EXCLUDE architecture-specific implementations
# We only want the generic implementations for Android
file(GLOB SOURCES_MAIN
    "${CMAKE_SOURCE_DIR}/../../../cpp/*.c"
    "${CMAKE_SOURCE_DIR}/../../../cpp/*.cpp"
)

file(GLOB SOURCES_GGML_CPU
    "${CMAKE_SOURCE_DIR}/../../../cpp/ggml-cpu/*.c"
    "${CMAKE_SOURCE_DIR}/../../../cpp/ggml-cpu/*.cpp"
)

file(GLOB SOURCES_TOOLS
    "${CMAKE_SOURCE_DIR}/../../../cpp/tools/mtmd/*.c"
    "${CMAKE_SOURCE_DIR}/../../../cpp/tools/mtmd/*.cpp"
)

# Combine all sources - explicitly exclude arch-specific directories
set(SOURCES ${SOURCES_MAIN} ${SOURCES_GGML_CPU} ${SOURCES_TOOLS})

# Remove architecture-specific files to avoid duplicates
list(FILTER SOURCES EXCLUDE REGEX ".*/arch/.*")

# Create shared library with ABI-specific name
add_library(llama-cpp-${ANDROID_ABI} SHARED ${SOURCES})

# Link libraries
find_library(log-lib log)
target_link_libraries(llama-cpp-${ANDROID_ABI}
    ${log-lib}
    android
)

# Set output directory
set_target_properties(llama-cpp-${ANDROID_ABI} PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/jniLibs/${ANDROID_ABI}"
)
