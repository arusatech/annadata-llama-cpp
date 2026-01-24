# Publishing llama-cpp-capacitor for iOS + Android

## Overview

This guide covers building and publishing the npm package with native binaries for **both iOS and Android**.

## Build Process

### Step 1: Build Native Binaries

**On macOS** (required for iOS builds):

```bash
cd llama-cpp

# Clean previous builds
rm -rf ios/build android/build android/src/main/jniLibs

# Build for both iOS and Android
./build-native.sh
```

This produces:
- **iOS**: 
  - `ios/build/llama-cpp.framework` (build output)
  - `ios/Frameworks/llama-cpp.framework` (stripped, then copied for npm package)
- **Android**: 
  - `android/src/main/jniLibs/arm64-v8a/libllama-cpp-arm64.so` (stripped; **arm64-only**)

**Note**: The script builds **arm64-v8a only** (matches `abiFilters` in `build.gradle`) and strips debug symbols to minimize app store size. See `APP_STORE_SIZE.md`.

### Step 2: Verify Binaries Are Present

**Android:**
```bash
ls -la android/src/main/jniLibs/arm64-v8a/libllama-cpp-arm64.so
```

**iOS:**
```bash
ls -la ios/Frameworks/llama-cpp.framework/llama-cpp
```

### Step 3: Create npm Package

```bash
npm pack
```

This creates `llama-cpp-capacitor-X.X.X.tgz` containing:
- Android `.so` libraries in `android/src/main/jniLibs/`
- iOS framework in `ios/Frameworks/` (if copied)
- TypeScript definitions
- Plugin source code

### Step 4: Publish to npm

```bash
npm login  # Login to annadataai.app@gmail.com
npm publish
```

## What Gets Packaged

The `package.json` `files` field includes:

- ✅ `android/src/main/` → includes `jniLibs/` with `.so` files
- ✅ `ios/Sources` → Swift plugin code
- ✅ `ios/Frameworks/` → iOS framework (automatically copied by `build-native.sh`)
- ✅ `dist/` → TypeScript build output
- ✅ `types/` → TypeScript definitions
- ✅ `cpp/` → C++ source (for reference, not used at runtime)

## Important Notes

1. **iOS Framework Location**: 
   - Build outputs to `ios/build/llama-cpp.framework`
   - **Automatically copied** to `ios/Frameworks/` by `build-native.sh`
   - The podspec references it as `vendored_framework`

2. **Android Libraries**:
   - Already in correct location: `android/src/main/jniLibs/<arch>/`
   - Automatically included via `android/src/main/` in `files` field

3. **Architecture Support**:
   - **iOS**: ARM64 only (real devices)
   - **Android**: arm64-v8a only (minimal app store size; see `APP_STORE_SIZE.md`)

4. **Web Support**:
   - Web uses JavaScript/TypeScript only (no native binaries)
   - The `dist/` folder contains web-compatible code

## Complete Publishing Workflow

```bash
# 1. Clean
cd llama-cpp
rm -rf ios/build android/build android/src/main/jniLibs ios/Frameworks

# 2. Build native binaries (automatically copies iOS framework)
./build-native.sh

# 3. Verify binaries
ls android/src/main/jniLibs/arm64-v8a/
ls ios/Frameworks/

# 4. Build TypeScript
npm run build

# 5. Create package
npm pack

# 6. Test locally (optional)
npm install ./llama-cpp-capacitor-X.X.X.tgz

# 7. Publish
npm login
npm publish
```

## After Publishing

**On mobile apps using the package:**

```bash
# Install the published package
npm install llama-cpp-capacitor@latest

# Sync Capacitor
npx cap sync

# iOS: Run pod install
cd ios/App && pod install && cd ../..

# Run
npx cap run android --target <device-id>
npx cap run ios --scheme App
```
