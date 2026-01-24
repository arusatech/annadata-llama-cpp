# All Patches Applied to ref-code/llama-cpp

This document lists all the fixes that have been applied directly to the source code in `ref-code/llama-cpp` so that when you publish the package, all fixes are included.

## iOS Fixes (LlamaCpp.swift)

### 1. Fixed Lazy Global Variable Error
- **Before**: `private lazy var llamaLibrary` (causes Swift error: 'lazy' cannot be used on an already-lazy global)
- **After**: Used `private enum LibraryLoader` with static property to avoid the lazy-on-global error
- **Location**: Lines 8-22

### 2. Added Capacitor Import
- **Added**: `import Capacitor` to access `JSObject`, `JSTypes`, etc.
- **Location**: Line 2

### 3. Fixed JSObject Usage
- **Before**: `JSObject(systemMessage)` and `JSObject(userMessage)` (invalid constructor)
- **After**: `JSTypes.coerceDictionaryToJSObject(systemMessage) ?? [:]`
- **Location**: Lines 381, 419

### 4. Fixed Dictionary Access
- **Before**: `allMessages.map { $0.dictionary }` (JSObject doesn't have .dictionary property)
- **After**: `allMessages` (direct use, JSObject is already a dictionary)
- **Location**: Line 381

### 5. Fixed getFormattedChat Return Type
- **Before**: `LlamaResult<Any>`
- **After**: `LlamaResult<[String: Any]>`
- **Location**: Line 290

### 6. Fixed generateText Method Call
- **Before**: `completion(contextId:contextId, params:completionParams, completion:completion)` (calling closure parameter)
- **After**: `self.completion(contextId:contextId, params:completionParams, completion:completion)` (calling method)
- **Location**: Line 435

### 7. Fixed getFormattedAudioCompletion nil Issue
- **Before**: `"grammar": nil` (invalid in dictionary)
- **After**: `"grammar": NSNull()`
- **Location**: Line 644

### 8. Added Missing Methods
Added complete implementations for:
- `downloadModel(url:filename:completion:)` - Downloads model files
- `getDownloadProgress(url:completion:)` - Returns download progress
- `cancelDownload(url:completion:)` - Cancels downloads
- `getAvailableModels(completion:)` - Scans for available model files
- `convertJsonSchemaToGrammar(schema:completion:)` - Converts JSON schema to grammar
- **Location**: Lines 734-841

### 9. Fixed Embedding Implementation
- **Before**: Returns empty array `["embedding": []]`
- **After**: Properly calls native `llama_embedding` function, validates model has `n_embd`, converts C float array to Swift/Double array
- **Location**: Lines 494-565

### 10. Added Embedding Function Pointer
- **Added**: `private var embeddingFunc: ((Int64, String, UnsafePointer<Int8>) -> UnsafePointer<Float>?)?`
- **Location**: Line 31, 43

## iOS Fixes (LlamaCppPlugin.swift)

### 11. Fixed addListener/removeAllListeners Override
- **Before**: `@objc func addListener(_ call: CAPPluginCall)` (missing override and public)
- **After**: `@objc override public func addListener(_ call: CAPPluginCall)`
- **Location**: Lines 565, 572

## Android Fixes (LlamaCpp.java)

### 12. Added Embedding Native Method Declaration
- **Added**: `private native Map<String, Object> embeddingNative(long contextId, String text, JSObject params);`
- **Location**: Line 275

### 13. Fixed Embedding Implementation
- **Before**: Generated random mock embeddings with `for (int i = 0; i < 384; i++) { embeddingList.add(Math.random() - 0.5); }`
- **After**: Calls `embeddingNative()` to get embeddings from C++ layer, with proper error handling and logging
- **Location**: Lines 879-904

## Summary

All patches that were previously applied via `patch-package` have now been directly applied to the source code in `ref-code/llama-cpp`. When you:

1. **Build the package** from `ref-code/llama-cpp`
2. **Publish it** to npm/your registry
3. **Install it** in your app

All these fixes will be included in the published package, and you won't need `patch-package` anymore.

## Next Steps

1. **Test the build** from `ref-code/llama-cpp` to ensure everything compiles
2. **Publish the package** with these fixes included
3. **Update your app** to use the published package (remove patch-package dependency if desired)
4. **Implement the native C++ layer** for embeddings (see `EMBEDDING_IMPLEMENTATION.md`)
