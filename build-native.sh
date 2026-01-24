#!/bin/bash

# Build script for llama-cpp Capacitor plugin
# This script compiles the native llama.cpp library for iOS and Android

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're on macOS for iOS builds
check_macos() {
    if [[ "$OSTYPE" != "darwin"* ]]; then
        print_warning "iOS builds require macOS. Skipping iOS build."
        return 1
    fi
    return 0
}

# Check if Android SDK is available
check_android_sdk() {
    if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
        print_warning "Android SDK not found. Please set ANDROID_HOME or ANDROID_SDK_ROOT."
        print_warning "Skipping Android build."
        return 1
    fi
    return 0
}

# Detect NDK path: ndk/<version>/build/cmake/android.toolchain.cmake
# Uses latest versioned NDK under $ANDROID_SDK/ndk/ (e.g. ndk/29.0.13113456).
detect_ndk() {
    local sdk="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
    local ndk_root="$sdk/ndk"
    if [ ! -d "$ndk_root" ]; then
        echo ""
        return 1
    fi
    local latest=""
    local latest_ver=0
    for v in "$ndk_root"/*; do
        [ -d "$v" ] || continue
        local base=$(basename "$v")
        if [[ "$base" =~ ^[0-9] ]]; then
            local ver=$(echo "$base" | sed 's/[^0-9]//g' | head -c 10)
            ver=${ver:-0}
            if [ "$ver" -gt "$latest_ver" ] 2>/dev/null; then
                latest_ver=$ver
                latest=$v
            fi
        fi
    done
    if [ -n "$latest" ] && [ -f "$latest/build/cmake/android.toolchain.cmake" ]; then
        echo "$latest"
        return 0
    fi
    echo ""
    return 1
}

# Build iOS library
build_ios() {
    print_status "Building iOS library..."
    
    if ! check_macos; then
        return 1
    fi
    
    # Always start from a clean iOS build directory to avoid stale Xcode settings
    rm -rf ios/build
    mkdir -p ios/build
    cd ios/build
    
    # Configure with CMake
    # IMPORTANT: build iOS framework as **ARM64-only**.
    # Including x86_64 here makes CMake/Xcode try to link an x86_64 slice,
    # but we only compile ARM-specific kernels (arch/arm), which leads to
    # undefined symbols like lm_ggml_gemm_* for x86_64.
    cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_OSX_ARCHITECTURES="arm64" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
        -DCMAKE_XCODE_ATTRIBUTE_ENABLE_BITCODE=NO
    
    # Build
    cmake --build . --config Release
    
    # CMake builds the framework directly (FRAMEWORK TRUE in CMakeLists.txt)
    # Verify the framework was created
    if [ -d "llama-cpp.framework" ]; then
        print_success "iOS framework built successfully at: $(pwd)/llama-cpp.framework"
    else
        print_error "iOS framework not found after build"
        cd ../..
        return 1
    fi
    
    cd ../..
}

# Build Android library
build_android() {
    print_status "Building Android library..."
    
    if ! check_android_sdk; then
        return 1
    fi
    
    ANDROID_NDK=$(detect_ndk)
    if [ -z "$ANDROID_NDK" ]; then
        print_error "Android NDK not found. Install NDK via Android Studio (SDK Manager → NDK)."
        print_error "Expected: \$ANDROID_HOME/ndk/<version>/build/cmake/android.toolchain.cmake"
        return 1
    fi
    print_status "Using NDK: $ANDROID_NDK"
    
    TOOLCHAIN_FILE="$ANDROID_NDK/build/cmake/android.toolchain.cmake"
    if [ ! -f "$TOOLCHAIN_FILE" ]; then
        print_error "Toolchain file not found: $TOOLCHAIN_FILE"
        return 1
    fi
    
    rm -rf android/build
    mkdir -p android/build
    cd android/build
    
    # Build only ARM architectures (CMakeLists.txt is ARM-specific)
    # x86/x86_64 would require separate CMakeLists with x86-specific optimizations
    for arch in arm64-v8a armeabi-v7a; do
        print_status "Building for $arch..."
        rm -rf CMakeCache.txt CMakeFiles Makefile cmake_install.cmake 2>/dev/null || true
        find . -maxdepth 1 -name '*.so' -delete 2>/dev/null || true
        
        cmake ../src/main \
            -DCMAKE_BUILD_TYPE=Release \
            -DANDROID_ABI=$arch \
            -DANDROID_PLATFORM=android-21 \
            -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE" \
            -DANDROID_STL=c++_shared
        
        cmake --build . --config Release
        
        mkdir -p ../src/main/jniLibs/$arch
        # The library is always named llama-cpp-arm64 regardless of ABI
        # (CMakeLists.txt hardcodes OUTPUT_NAME)
        if [ "$arch" = "arm64-v8a" ]; then
            [ -f "libllama-cpp-arm64.so" ] && cp "libllama-cpp-arm64.so" "../src/main/jniLibs/$arch/" || true
        elif [ "$arch" = "armeabi-v7a" ]; then
            # For armeabi-v7a, the build still produces llama-cpp-arm64.so
            # but we need to copy it to the correct directory
            [ -f "libllama-cpp-arm64.so" ] && cp "libllama-cpp-arm64.so" "../src/main/jniLibs/$arch/" || true
        fi
        print_success "Built for $arch"
    done
    
    print_success "Android library built successfully"
    cd ../..
}

# Main build function
main() {
    print_status "Starting llama-cpp Capacitor plugin build..."
    
    # Check dependencies
    if ! command -v cmake &> /dev/null; then
        print_error "CMake is required but not installed"
        exit 1
    fi
    
    if ! command -v make &> /dev/null; then
        print_error "Make is required but not installed"
        exit 1
    fi
    
    # Build iOS
    if check_macos; then
        build_ios
    fi
    
    # Build Android
    if check_android_sdk; then
        build_android
    fi
    
    print_success "Build completed successfully!"
}

# Run main function
main "$@"
