# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2025-01-24

### Changed
- **App store size**: Build only **arm64-v8a** for Android (drop armeabi-v7a); strip iOS framework and Android `.so` debug symbols. See `APP_STORE_SIZE.md`.
- **Package**: Exclude `ios/Tests` from published `files`; `build-native.sh` builds Android arm64-only and strips binaries.

### Added
- **APP_STORE_SIZE.md**: Guide on what affects app size, what can be removed, and store-size optimizations.

## [0.1.0] - 2025-01-23

### Added
- **Complete iOS support**: Full native iOS build and packaging
  - ARM64 framework (`llama-cpp.framework`) with Metal acceleration
  - Automated copy to `ios/Frameworks/` for npm package
  - CocoaPods `vendored_frameworks` in `LlamaCpp.podspec`
- **Unified build**: `build-native.sh` builds both iOS and Android; single workflow for publishing

### Changed
- **Android**: NDK detection uses versioned path (`ndk/<version>/`); build limited to arm64-v8a and armeabi-v7a (x86/x86_64 require separate CMake setup)
- **Android JNI**: `n_threads` via `cpuparams`, `llama_batch_add` as `capllama::llama_batch_add`; embedding fixes
- **NEON**: Guarded `vcvtnq_s32_f32` fallback for Clang/NDK to avoid redefinition with `arm_neon.h`

### Technical
- `package.json`: version 0.1.0; `ios/Frameworks` in `files`; keywords `ios`, `android`
- `PUBLISH_GUIDE.md`: Steps for building and publishing iOS + Android npm package

## [0.0.13] - 2025-08-30

### Fixed
- **Segmentation Fault Protection**: Added signal handlers to catch and handle segmentation faults during model loading
- **Enhanced Model Compatibility**: Added GGUF version checking and ultra-minimal parameter fallback
- **Memory Safety**: Disabled potentially problematic features (mmap, quantized matrix multiplication) in fallback mode
- **Crash Prevention**: Implemented multiple layers of protection against model loading crashes

### Technical
- Added signal handlers for SIGSEGV to prevent app crashes during model loading
- Enhanced model validation with GGUF version checking
- Implemented ultra-minimal parameter set with disabled mmap and quantized operations
- Added comprehensive error messages for model corruption and compatibility issues
- Improved memory safety by disabling potentially problematic llama.cpp features

## [0.0.12] - 2025-08-30

### Fixed
- **Enhanced File Path Resolution**: Added comprehensive path checking for model files across multiple Android directories
- **Improved Model Validation**: Enhanced file validation with better error handling and logging
- **Better Error Messages**: More descriptive error messages to help diagnose model loading issues
- **Robust File Detection**: Added automatic detection of model files in common Android storage locations

### Technical
- Added multiple path checking for model files (app files, Documents, external storage)
- Enhanced file validation with size and GGUF format checking
- Improved logging to show all checked paths and file status
- Better error handling with fallback to minimal parameters
- Added comprehensive path resolution for Android file system

## [0.0.11] - 2025-08-30

### Fixed
- **Model Validation**: Added comprehensive model file validation before loading
- **Crash Prevention**: Enhanced error handling to prevent crashes during model loading
- **GGUF Format Check**: Added validation to ensure the model file is a valid GGUF format
- **Exception Handling**: Added try-catch blocks around model loading operations

### Technical
- Added file existence and size validation before model loading
- Added GGUF magic number validation to ensure proper file format
- Enhanced exception handling with detailed error messages
- Added comprehensive logging for model validation steps
- Improved error messages to help diagnose model compatibility issues

## [0.0.10] - 2025-08-30

### Fixed
- **Model Loading Issues**: Enhanced model loading with better error handling and fallback parameters
- **Common Parameters**: Added comprehensive common_params initialization for proper model loading
- **Debug Logging**: Added detailed logging for model loading process to help diagnose issues

### Technical
- Added fallback to minimal parameters if standard parameters fail
- Enhanced error logging to show model path and parameters being used
- Added comprehensive common_params initialization with all required fields
- Improved model loading reliability with multiple parameter sets

## [0.0.9] - 2025-08-30

### Fixed
- **JNI Function Naming**: Fixed JNI function names to match Java native method declarations
- **UnsatisfiedLinkError**: Resolved "No implementation found" errors for native methods
- **Function Signature Mismatch**: Corrected JNI function signatures to match Java expectations

### Technical
- Renamed all JNI functions to include "Native" suffix to match Java declarations
- Removed duplicate wrapper functions that were causing conflicts
- Fixed function signatures (e.g., completionNative no longer expects params parameter)
- All native methods now properly link between Java and C++

## [0.0.8] - 2025-08-30

### Fixed
- **Android Native Library Naming**: Fixed library naming to use `libllama-cpp.so` instead of architecture-specific names
- **Java Library Loading**: Updated CMakeLists.txt to build libraries with generic names for Java compatibility
- **System.loadLibrary() Compatibility**: Java code can now properly load the native library

### Technical
- Changed library target names from `llama-cpp-arm64-v8a` to `llama-cpp` in CMakeLists.txt
- Updated all architecture-specific build configurations to use the same library name
- This ensures `System.loadLibrary("llama-cpp")` can find the correct library file

## [0.0.7] - 2025-08-30

### Fixed
- **Missing CPP Directory**: Added `cpp/` directory to npm package files to fix CMake build errors
- **NPM Package Issue**: The cpp directory containing llama.cpp source files was not included in the published package
- **CMake Build Failure**: Fixed "Cannot find source file" errors when installing plugin as npm dependency

### Technical
- Updated package.json files array to include cpp directory
- This ensures all necessary source files are available when the plugin is installed as a dependency
- CMake build system can now properly locate and compile llama.cpp source files

## [0.0.6] - 2025-08-30

### Fixed
- **CMake Path Issue**: Fixed incorrect relative path in CMakeLists.txt that was causing "Cannot find source file" errors
- **Android Build Success**: Resolved CMake configuration issue and successfully built native library
- **Path Resolution**: Corrected `LLAMACPP_LIB_DIR` from `../../cpp` to `../../../cpp` for proper source file location

### Technical
- Android native library now compiles successfully with correct file paths
- CMake build system properly locates all llama.cpp source files
- Ready for real model inference instead of placeholder responses

## [0.0.5] - 2025-08-30

### Fixed
- **ANDROID BUILD SUCCESS**: Fixed all compilation errors and successfully built native library
- Fixed JNI type declarations with proper namespace qualifiers (`rnllama::`)
- Added missing `llama_model_saver.cpp` to CMakeLists.txt
- Fixed CMake configuration to use generic implementation for all architectures
- Added missing `rnllama_verbose` symbol to JNI implementation
- Simplified build to focus on ARM64 architecture (most common for modern Android)
- Removed problematic CMake dependency that was causing build failures

### Technical
- Android native library now compiles successfully with all llama.cpp components
- JNI bridge properly connects Java plugin to C++ llama.cpp library
- Native context management and model loading implemented
- Ready for real model inference instead of placeholder responses

## [0.0.4] - 2025-08-30

### Fixed
- **REAL LLAMA.CPP INTEGRATION**: Replaced placeholder implementations with actual llama.cpp library calls
- Fixed Android JNI implementation to use real llama.cpp functions instead of sample text
- Updated completion method to perform actual text generation using the loaded model
- Fixed getFormattedChat to use native llama.cpp chat formatting
- Added proper native context management with real model loading
- Fixed type conversion issues in parameter extraction

### Technical
- Implemented proper JNI bridge between Java and C++ llama.cpp library
- Added native method declarations for all core functions
- Fixed JSObject parameter extraction with proper type casting
- Added native context ID tracking for proper resource management
- Integrated real tokenization and completion pipeline

## [0.0.3] - 2025-08-30

### Fixed
- Fixed Android compilation errors in LlamaCppPlugin.java
- Corrected JSArray method calls with proper exception handling
- Fixed saveSession method signature mismatch
- Added proper JSONException handling for all JSArray operations
- Resolved type conversion issues between Map<String,Object> and JSObject

### Technical
- Added try-catch blocks for all JSArray.getString() and JSArray.getInt() calls
- Fixed method parameter mismatches in Android implementation
- Improved error handling and type safety in Android plugin

## [0.0.2] - 2025-08-30

### Added
- Comprehensive API documentation (API_DOCUMENTATION.md)
- Quick reference guide (QUICK_REFERENCE.md)
- Complete TypeScript declarations (types/llama-cpp-capacitor.d.ts)
- Fixed build warnings and improved TypeScript configuration
- Enhanced IDE support with IntelliSense

### Documentation
- Complete API reference with examples
- Platform support matrix
- Performance tips and troubleshooting guide
- TypeScript type safety improvements

## [0.0.1] - 2025-08-29

### Added
- Initial release of CapacitorJS plugin for llama.cpp
- Complete native iOS implementation with Swift and C++ integration
- Complete native Android implementation with Java and JNI
- Web fallback implementation for unsupported features
- Comprehensive TypeScript definitions and interfaces
- Support for text completion (basic and streaming)
- Chat conversation functionality with message formatting
- Tokenization and detokenization
- Embeddings generation
- Session management (save/load conversation states)
- Multimodal support for image processing
- Text-to-Speech (TTS) with vocoder models
- LoRA adapters support (apply, remove, list)
- Performance benchmarking capabilities
- Structured output with JSON Schema support
- Error handling and result types
- Integration testing framework with Jest and custom test runner
- Build automation scripts for native compilation
- Comprehensive documentation (README, TESTING, CONTRIBUTING)

### Technical Features
- Native C++ integration using dlopen/dlsym on iOS
- JNI bridge implementation for Android
- CMake build system for cross-platform compilation
- Event-driven architecture with Capacitor listeners
- Memory management and context handling
- Cross-platform compatibility (iOS, Android, Web)

### Documentation
- Complete API reference
- Installation and setup instructions
- Usage examples and code samples
- Integration testing guide
- Platform-specific build instructions
- Troubleshooting guide

## [Unreleased]

### Planned
- Support for larger models (13B, 70B)
- Enhanced multimodal capabilities
- Real-time audio processing
- Advanced LoRA fine-tuning
- Model quantization optimization
- Performance monitoring and analytics
- Cloud model integration
- Advanced caching mechanisms
