# X86_64 Build for Emulator Development

This directory contains build scripts and configurations specifically optimized for x86_64 architecture, designed for emulator development and testing.

## 🎯 Purpose

The x86_64 build is optimized for:
- **iOS Simulator** development and testing
- **Android Emulator** development and testing
- **Development machines** with x86_64 processors
- **CI/CD pipelines** running on x86_64 servers

## 📁 Files

### Build Scripts
- `build-native-x86_64.sh` - Main build script for x86_64 only
- `build-native.sh` - Original multi-architecture build script

### CMake Configuration Files
- `ios/CMakeLists-x86_64.txt` - iOS x86_64 optimized build
- `android/src/main/CMakeLists-x86_64.txt` - Android x86_64 optimized build

## 🚀 Quick Start

### Prerequisites
- **CMake** (3.16+ for iOS, 3.10+ for Android)
- **Xcode** (for iOS builds, macOS only)
- **Android Studio** with NDK (for Android builds)
- **Make** or **Ninja** build system

### Building for X86_64

```bash
# Make the script executable
chmod +x build-native-x86_64.sh

# Build for all platforms (x86_64 only)
./build-native-x86_64.sh

# Or build for specific platforms
./build-native-x86_64.sh ios      # iOS only
./build-native-x86_64.sh android  # Android only
```

## 🔧 Build Differences

### X86_64 vs Multi-Architecture

| Feature | X86_64 Build | Multi-Arch Build |
|---------|--------------|------------------|
| **Architecture** | x86_64 only | arm64 + x86_64 |
| **Optimizations** | AVX2, AVX, SSE3, SSE, FMA, F16C | Generic + ARM NEON |
| **Use Case** | Emulator/Development | Production devices |
| **Build Time** | Faster | Slower (multiple archs) |
| **Binary Size** | Smaller | Larger (multiple archs) |

### X86_64 Optimizations

The x86_64 build includes:
- **AVX2** - Advanced Vector Extensions 2
- **AVX** - Advanced Vector Extensions
- **SSE3/SSE** - Streaming SIMD Extensions
- **FMA** - Fused Multiply-Add
- **F16C** - 16-bit floating-point conversion

## 📱 Platform-Specific Notes

### iOS Simulator
- **Target**: x86_64 only
- **Deployment**: iOS 13.0+
- **Frameworks**: Metal, Accelerate, CoreGraphics
- **Output**: `ios/build/LlamaCpp.framework/`

### Android Emulator
- **Target**: x86_64 only
- **API Level**: 21+
- **STL**: c++_shared
- **Output**: `android/src/main/jniLibs/x86_64/`

## ⚠️ Important Notes

### Limitations
- **NOT suitable** for production ARM64 devices
- **Emulator only** - won't work on physical ARM devices
- **Performance** may differ from ARM64 builds

### When to Use
- ✅ **Development and testing** on emulators
- ✅ **CI/CD pipelines** on x86_64 servers
- ✅ **Local development** on x86_64 machines
- ❌ **Production builds** for mobile devices
- ❌ **App Store releases**

## 🔄 Switching Between Builds

### For Development (X86_64)
```bash
./build-native-x86_64.sh
```

### For Production (Multi-Arch)
```bash
./build-native.sh
```

## 🐛 Troubleshooting

### Common Issues

1. **CMake not found**
   ```bash
   # Install CMake
   brew install cmake  # macOS
   sudo apt install cmake  # Ubuntu
   ```

2. **Android NDK not found**
   ```bash
   # Set environment variables
   export ANDROID_HOME=/path/to/android/sdk
   export ANDROID_NDK=$ANDROID_HOME/ndk
   ```

3. **Xcode not found** (iOS builds)
   ```bash
   # Install Xcode from App Store
   # Accept license
   sudo xcodebuild -license accept
   ```

### Build Failures

- **Clean build directories** if you encounter issues:
  ```bash
  npm run clean:native
  ```
- **Check architecture** - ensure you're building for the right target
- **Verify dependencies** - CMake, NDK, Xcode versions

## 📚 Additional Resources

- [Original README](README.md) - Complete project documentation
- [API Documentation](API_DOCUMENTATION.md) - Plugin API reference
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md) - Technical details
- [Testing Guide](TESTING.md) - Testing instructions

## 🤝 Contributing

When contributing to the x86_64 build:
1. **Test both builds** - ensure changes work for both x86_64 and multi-arch
2. **Update both CMakeLists** - maintain consistency between builds
3. **Document changes** - update this README if needed
4. **Test on emulators** - verify x86_64 builds work correctly
