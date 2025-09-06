#!/bin/bash

# Complete build script for llama-cpp Capacitor plugin - ARM64 (Real Android Devices)
# This script:
# 1. Builds the native llama.cpp library for ARM64
# 2. Updates build.gradle to support ARM64
# 3. Builds the complete Android plugin

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

# Cleanup function to restore original files
cleanup() {
    print_status "Cleaning up..."
    
    # Restore iOS CMakeLists.txt if backup exists
    if [ -f "ios/CMakeLists.txt.backup" ]; then
        mv ios/CMakeLists.txt.backup ios/CMakeLists.txt
        print_status "Restored iOS CMakeLists.txt"
    fi
    
    # Restore Android CMakeLists.txt if backup exists
    if [ -f "android/src/main/CMakeLists.txt.backup" ]; then
        mv android/src/main/CMakeLists.txt.backup android/src/main/CMakeLists.txt
        print_status "Restored Android CMakeLists.txt"
    fi
    
    # Restore build.gradle if backup exists
    if [ -f "android/build.gradle.backup" ]; then
        mv android/build.gradle.backup android/build.gradle
        print_status "Restored android/build.gradle"
    fi
}

# Set trap to cleanup on exit (success or failure)
trap cleanup EXIT

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
        print_warning "You can set them in your shell profile (~/.bashrc, ~/.zshrc):"
        print_warning "  export ANDROID_HOME=/path/to/android/sdk"
        print_warning "  export ANDROID_SDK_ROOT=/path/to/android/sdk"
        print_warning "  export PATH=\$PATH:\$ANDROID_HOME/tools:\$ANDROID_HOME/platform-tools"
        print_warning "Skipping Android build."
        return 1
    fi
    return 0
}

# Setup Android environment
setup_android_env() {
    print_status "Setting up Android environment..."
    
    # Try to find Android SDK in common locations
    local sdk_paths=(
        "/opt/android-sdk"
        "/usr/local/android-sdk"
        "$HOME/Android/Sdk"
        "$HOME/Library/Android/sdk"
        "/usr/local/lib/android/sdk"
    )
    
    for path in "${sdk_paths[@]}"; do
        if [ -d "$path" ]; then
            print_status "Found Android SDK at: $path"
            if [ -z "$ANDROID_HOME" ]; then
                export ANDROID_HOME="$path"
                print_status "Set ANDROID_HOME=$ANDROID_HOME"
            fi
            if [ -z "$ANDROID_SDK_ROOT" ]; then
                export ANDROID_SDK_ROOT="$path"
                print_status "Set ANDROID_SDK_ROOT=$ANDROID_SDK_ROOT"
            fi
            return 0
        fi
    done
    
    print_warning "Could not automatically find Android SDK."
    print_warning "Please set ANDROID_HOME and ANDROID_SDK_ROOT manually."
    return 1
}

# Check if build tools are available
check_build_tools() {
    if ! command -v cmake &> /dev/null; then
        print_error "CMake is required but not installed"
        print_error "Please install CMake:"
        print_error "  Ubuntu/Debian: sudo apt install cmake"
        print_error "  CentOS/RHEL: sudo yum install cmake"
        print_error "  macOS: brew install cmake"
        return 1
    fi
    
    if ! command -v make &> /dev/null && ! command -v ninja &> /dev/null; then
        print_error "Neither 'make' nor 'ninja' build tools found."
        print_error "Please install one of them:"
        print_error "  Ubuntu/Debian: sudo apt install make"
        print_error "  Ubuntu/Debian: sudo apt install ninja-build"
        print_error "  CentOS/RHEL: sudo yum install make"
        print_error "  macOS: brew install make"
        print_error "  macOS: brew install ninja"
        return 1
    fi
    
    if ! command -v gradle &> /dev/null && [ ! -f "android/gradlew" ]; then
        print_error "Gradle is required but not found."
        print_error "Please install Gradle or ensure gradlew wrapper exists."
        return 1
    fi
    
    return 0
}

# Simple NDK detection
detect_ndk() {
    local base_path="/opt/android-sdk/ndk"
    
    if [ ! -d "$base_path" ]; then
        return 1
    fi
    
    # Find the highest version number
    local highest_version=""
    local highest_num=0
    
    for version_dir in "$base_path"/*; do
        if [ -d "$version_dir" ] && [[ "$(basename "$version_dir")" =~ ^[0-9] ]]; then
            local version_name=$(basename "$version_dir")
            local version_num=$(echo "$version_name" | sed 's/[^0-9]//g')
            
            if [ "$version_num" -gt "$highest_num" ]; then
                highest_num="$version_num"
                highest_version="$version_dir"
            fi
        fi
    done
    
    if [ -n "$highest_version" ]; then
        echo "$highest_version"
        return 0
    fi
    
    return 1
}

# Check NDK compatibility
check_ndk_compatibility() {
    local ndk_path="$1"
    
    print_status "Checking NDK compatibility..."
    
    # Check for toolchain file
    if [ -f "$ndk_path/build/cmake/android.toolchain.cmake" ]; then
        print_success "Toolchain file found"
    else
        print_error "Toolchain file not found"
        return 1
    fi
    
    # Check for modern NDK structure
    if [ -d "$ndk_path/toolchains/llvm/prebuilt/linux-x86_64" ]; then
        print_success "Modern NDK structure detected"
        
        if [ -d "$ndk_path/toolchains/llvm/prebuilt/linux-x86_64/sysroot" ]; then
            print_success "Sysroot found"
        fi
        
        if [ -d "$ndk_path/toolchains/llvm/prebuilt/linux-x86_64/bin" ]; then
            print_success "Build tools found"
        fi
        
        return 0
    fi
    
    # Check for legacy structure
    if [ -d "$ndk_path/toolchains" ] && [ -d "$ndk_path/sysroot" ]; then
        print_success "Legacy NDK structure detected"
        return 0
    fi
    
    print_warning "NDK structure unclear, but toolchain file exists - attempting to use"
    return 0
}

# Check and install required packages (Ubuntu/Debian)
check_ubuntu_packages() {
    if command -v apt &> /dev/null; then
        print_status "Checking for required packages on Ubuntu/Debian..."
        
        local missing_packages=()
        
        if ! command -v cmake &> /dev/null; then
            missing_packages+=("cmake")
        fi
        
        if ! command -v make &> /dev/null; then
            missing_packages+=("make")
        fi
        
        if ! command -v g++ &> /dev/null; then
            missing_packages+=("build-essential")
        fi
        
        if [ ${#missing_packages[@]} -gt 0 ]; then
            print_warning "Missing packages: ${missing_packages[*]}"
            print_status "You can install them with:"
            print_status "  sudo apt update && sudo apt install ${missing_packages[*]}"
            
            read -p "Would you like me to try to install these packages? (y/N): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                print_status "Installing packages..."
                sudo apt update && sudo apt install "${missing_packages[@]}"
                if [ $? -eq 0 ]; then
                    print_success "Packages installed successfully!"
                    return 0
                else
                    print_error "Failed to install packages. Please install manually."
                    return 1
                fi
            else
                print_warning "Please install the required packages manually and try again."
                return 1
            fi
        else
            print_success "All required packages are installed."
            return 0
        fi
    fi
    return 0
}

# Update build.gradle to support ARM64
update_build_gradle() {
    print_status "Updating build.gradle to support ARM64..."
    
    # Backup original build.gradle
    if [ -f "android/build.gradle" ]; then
        cp android/build.gradle android/build.gradle.backup
        print_status "Backed up android/build.gradle"
    fi
    
    # Create ARM64 version of build.gradle
    cat > android/build.gradle << 'EOF'
ext {
    junitVersion = project.hasProperty('junitVersion') ? rootProject.ext.junitVersion : '4.13.2'
    androidxAppCompatVersion = project.hasProperty('androidxAppCompatVersion') ? rootProject.ext.androidxAppCompatVersion : '1.7.0'
    androidxJunitVersion = project.hasProperty('androidxJunitVersion') ? rootProject.ext.androidxJunitVersion : '1.2.1'
    androidxEspressoCoreVersion = project.hasProperty('androidxEspressoCoreVersion') ? rootProject.ext.androidxEspressoCoreVersion : '3.6.1'
}

buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:8.7.2'
    }
}

apply plugin: 'com.android.library'

android {
    namespace "ai.annadata.plugin.capacitor"
    compileSdk project.hasProperty('compileSdkVersion') ? rootProject.ext.compileSdkVersion : 35
    defaultConfig {
        minSdkVersion project.hasProperty('minSdkVersion') ? rootProject.ext.minSdkVersion : 23
        targetSdkVersion project.hasProperty('targetSdkVersion') ? rootProject.ext.targetSdkVersion : 35
        versionCode 1
        versionName "1.0"
        testInstrumentationRunner "androidx.test.runner.AndroidJUnitRunner"
        
        ndk {
            abiFilters 'arm64-v8a'
        }
    }
    
    externalNativeBuild {
        cmake {
            path "src/main/CMakeLists.txt"
            version "3.22.1"
            // Explicitly set NDK version to avoid Windows dependencies
            ndkVersion "29.0.13113456"
        }
    }
    
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
    
    lintOptions {
        abortOnError false
    }
    
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_21
        targetCompatibility JavaVersion.VERSION_21
    }
    
    sourceSets {
        main {
            java {
                srcDirs = ['src/main/java']
            }
        }
    }
    
    // Disable clean tasks that might cause issues
    tasks.whenTaskAdded { task ->
        if (task.name.contains('Clean') && task.name.contains('Debug')) {
            task.enabled = false
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    implementation project(':capacitor-android')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
    testImplementation "junit:junit:$junitVersion"
    androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"
    androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"
}
EOF
    
    print_success "Updated build.gradle to support ARM64 only"
}

# Build iOS library for ARM64
build_ios() {
    print_status "Building iOS library for ARM64 (real devices)..."
    
    if ! check_macos; then
        return 1
    fi
    
    # Check if ARM64 CMakeLists exists, if not use default
    local cmake_file="ios/CMakeLists.txt"
    if [ -f "ios/CMakeLists-arm64.txt" ]; then
        cmake_file="ios/CMakeLists-arm64.txt"
        print_status "Using ARM64-specific CMakeLists.txt"
    else
        print_status "Using default CMakeLists.txt"
    fi
    
    # Backup original CMakeLists.txt and copy ARM64 version if needed
    if [ -f "ios/CMakeLists.txt" ]; then
        cp ios/CMakeLists.txt ios/CMakeLists.txt.backup
    fi
    
    if [ "$cmake_file" != "ios/CMakeLists.txt" ]; then
        cp "$cmake_file" ios/CMakeLists.txt
    fi
    
    # Create build directory
    mkdir -p ios/build
    cd ios/build
    
    # Configure with CMake for ARM64
    cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_OSX_ARCHITECTURES="arm64" \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
        -DCMAKE_XCODE_ATTRIBUTE_ENABLE_BITCODE=NO \
        -DCMAKE_XCODE_ATTRIBUTE_ONLY_ACTIVE_ARCH=NO
    
    # Build
    cmake --build . --config Release
    
    # Create framework
    mkdir -p LlamaCpp.framework/Versions/A/Headers
    mkdir -p LlamaCpp.framework/Versions/A/Resources
    
    # Copy library
    cp libllama-cpp.dylib LlamaCpp.framework/Versions/A/LlamaCpp
    
    # Create symbolic links
    cd LlamaCpp.framework/Versions
    ln -sf A Current
    cd ..
    ln -sf Versions/Current/LlamaCpp LlamaCpp
    ln -sf Versions/Current/Headers Headers
    ln -sf Versions/Current/Resources Resources
    
    # Copy headers
    cp ../../cpp/cap-llama.h Versions/A/Headers/
    cp ../../cpp/cap-completion.h Versions/A/Headers/
    cp ../../cpp/cap-tts.h Versions/A/Headers/
    cp ../../cpp/llama.h Versions/A/Headers/
    cp ../../cpp/ggml.h Versions/A/Headers/
    
    # Create Info.plist
    cat > Versions/A/Resources/Info.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>LlamaCpp</string>
    <key>CFBundleIdentifier</key>
    <string>com.arusatech.llama-cpp</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>LlamaCpp</string>
    <key>CFBundlePackageType</key>
    <string>FMWK</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
</dict>
</plist>
EOF
    
    cd ../..
    print_success "iOS library built successfully for ARM64 (real devices)"
}

# Build Android library for ARM64
build_android() {
    print_status "Building Android library for ARM64 (real devices)..."
    
    if ! check_android_sdk; then
        return 1
    fi
    
    if ! check_build_tools; then
        return 1
    fi
    
    # Simple NDK detection
    print_status "Detecting Android NDK..."
    local ndk_path
    ndk_path=$(detect_ndk)
    
    if [ -z "$ndk_path" ]; then
        print_error "No Android NDK found at /opt/android-sdk/ndk"
        return 1
    fi
    
    print_status "Found NDK at: $ndk_path"
    
    # Check compatibility
    if ! check_ndk_compatibility "$ndk_path"; then
        print_error "NDK compatibility check failed"
        return 1
    fi
    
    # Set toolchain file path
    local toolchain_file="$ndk_path/build/cmake/android.toolchain.cmake"
    print_status "Using toolchain file: $toolchain_file"
    
    # Backup original CMakeLists.txt and copy ARM64 version
    if [ -f "android/src/main/CMakeLists.txt" ]; then
        cp android/src/main/CMakeLists.txt android/src/main/CMakeLists.txt.backup
        print_status "Backed up original CMakeLists.txt"
    fi
    
    # Use ARM64-specific CMakeLists.txt
    if [ -f "android/src/main/CMakeLists-arm64.txt" ]; then
        cp android/src/main/CMakeLists-arm64.txt android/src/main/CMakeLists.txt
        print_status "Using ARM64-specific CMakeLists.txt"
    else
        print_error "ARM64 CMakeLists.txt not found!"
        return 1
    fi
    
    # Create build directory
    mkdir -p android/build
    cd android/build
    
    # Build ONLY for ARM64 for real device use
    print_status "Building for ARM64 (real devices)..."
    
    # Configure with CMake
    cmake ../src/main \
        -DCMAKE_BUILD_TYPE=Release \
        -DANDROID_ABI=arm64-v8a \
        -DCMAKE_TOOLCHAIN_FILE="$toolchain_file" \
        -DANDROID_STL=c++_shared \
        -DANDROID_NATIVE_API_LEVEL=23
    
    # Build with parallel jobs (use all available CPU cores)
    cmake --build . --config Release --parallel $(nproc)
    
    # The library should already be in the correct location from CMake
    # Just verify it exists
    if [ -f "../src/main/jniLibs/arm64-v8a/libllama-cpp-arm64.so" ]; then
        print_success "Library built successfully and found in jniLibs/arm64-v8a/"
    else
        print_error "Library not found in expected location"
        return 1
    fi
    
    cd ../..
    print_success "Android library built successfully for ARM64 (real devices)"
}

# Build complete Android plugin
build_android_plugin() {
    print_status "Building complete Android plugin..."
    
    # Set environment variables to ensure Linux paths
    export ANDROID_NDK_HOME="/opt/android-sdk/ndk/29.0.13113456"
    export CMAKE_EXECUTABLE="/usr/bin/cmake"
    export PATH="/usr/bin:$PATH"
    
    print_status "Set ANDROID_NDK_HOME=$ANDROID_NDK_HOME"
    print_status "Set CMAKE_EXECUTABLE=$CMAKE_EXECUTABLE"
    
    cd android
    
    # Check if gradlew exists
    if [ -f "gradlew" ]; then
        print_status "Using gradlew wrapper..."
        chmod +x gradlew
        # Skip clean to avoid issues, go straight to assembleRelease
        ./gradlew assembleRelease
    elif command -v gradle &> /dev/null; then
        print_status "Using system gradle..."
        # Skip clean to avoid issues, go straight to assembleRelease
        gradle assembleRelease
    else
        print_error "No Gradle found. Cannot build Android plugin."
        cd ..
        return 1
    fi
    
    if [ $? -eq 0 ]; then
        print_success "Android plugin built successfully!"
        
        # Show output locations
        if [ -f "build/outputs/aar/llama-cpp-capacitor-release.aar" ]; then
            print_success "Plugin AAR: build/outputs/aar/llama-cpp-capacitor-release.aar"
        fi
        
        if [ -d "build/intermediates/cmake/release/obj/arm64-v8a" ]; then
            print_success "Native libraries: build/intermediates/cmake/release/obj/arm64-v8a"
        fi
        
        if [ -d "src/main/jniLibs/arm64-v8a" ]; then
            print_success "JNI libraries: src/main/jniLibs/arm64-v8a"
        fi
    else
        print_error "Failed to build Android plugin"
        cd ..
        return 1
    fi
    
    cd ..
}

# Main build function
main() {
    print_status "Starting complete llama-cpp Capacitor plugin build for ARM64 (real devices)..."
    print_success "This build is optimized for production ARM64 devices!"
    
    # Check and install required packages
    if ! check_ubuntu_packages; then
        print_error "Required packages are missing. Please install them and try again."
        exit 1
    fi
    
    # Check dependencies
    if ! check_build_tools; then
        print_error "Build tools are missing. Please install them and try again."
        exit 1
    fi
    
    # Build iOS
    if check_macos; then
        build_ios
    fi
    
    # Setup Android environment and build native libraries
    if setup_android_env || check_android_sdk; then
        build_android
        
        # Update build.gradle for ARM64 support
        update_build_gradle
        
        # Build complete Android plugin
        build_android_plugin
    fi
    
    print_success "Complete ARM64 build completed successfully for real devices!"
    print_success "This build is suitable for production ARM64 devices!"
    print_status "The Android plugin is now ready for use in your Capacitor project."
}

# Run main function
main "$@"
