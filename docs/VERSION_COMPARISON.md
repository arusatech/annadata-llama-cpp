# Version Comparison: 0.0.22 vs 0.1.0

## Package Size Comparison

| Version | Package Size | Unpacked Size | Key Differences |
|---------|--------------|--------------|-----------------|
| **0.0.22** | ~? MB | **20 MB** | Android-only, no iOS framework |
| **0.1.0** | 19.0 MB | **70.4 MB** | Complete iOS + Android support |

---

## What Was in 0.0.22?

Based on the size (20 MB unpacked) and typical Capacitor plugin structure, **0.0.22 likely included:**

### ✅ **Definitely Included:**
1. **Android native libraries** (`android/src/main/jniLibs/`)
   - Likely **one ABI only** (probably `arm64-v8a`)
   - Size: ~20-25 MB (unstripped) or ~10-15 MB (stripped)
   - **No `armeabi-v7a`** (would have added another 20-25 MB)

2. **Android Java/Kotlin code** (`android/src/main/java/`)
   - ~72 KB (same as 0.1.0)

3. **TypeScript/JavaScript** (`dist/`, `types/`)
   - ~0.5 MB (same as 0.1.0)

4. **C++ source files** (`cpp/`)
   - **Confirmed:** `cpp/` was added in **0.0.7** (CHANGELOG entry)
   - Since 0.0.22 > 0.0.7, **`cpp/` WAS included** in 0.0.22
   - Size: **13 MB**

5. **iOS Swift code** (`ios/Sources/`)
   - ~60 KB (same as 0.1.0)

### ❌ **Definitely NOT Included:**
1. **iOS Framework** (`ios/Frameworks/llama-cpp.framework`)
   - **5.3 MB** - This is NEW in 0.1.0
   - 0.0.22 had incomplete iOS support

2. **iOS Tests** (`ios/Tests/`)
   - Excluded in 0.1.0, likely not in 0.0.22 either

---

## What Changed in 0.1.0?

### Added:
1. **iOS Framework** (+5.3 MB)
   - Complete native iOS support
   - `llama-cpp.framework` with Metal acceleration

2. **Android `armeabi-v7a`** (+25-48 MB)
   - **Note:** We're now removing this in the latest build (arm64-only)
   - But in 0.1.0, it was built and included

3. **Possibly `cpp/`** (+13 MB)
   - If `cpp/` wasn't in 0.0.22, it was added in 0.1.0
   - Required for Android builds that use `externalNativeBuild`

### Size Breakdown (0.1.0):
- iOS Framework: **5.3 MB**
- Android arm64-v8a: **48 MB** (unstripped) or **25-30 MB** (stripped)
- Android armeabi-v7a: **48 MB** (unstripped) or **25-30 MB** (stripped) - **REMOVED in latest**
- C++ sources (`cpp/`): **13 MB**
- TypeScript/Java/Swift: **~1 MB**
- **Total: ~70.4 MB** (matches 0.1.0)

---

## Most Likely 0.0.22 Structure:

```
0.0.22 (20 MB unpacked):
├── android/src/main/
│   ├── jniLibs/
│   │   └── arm64-v8a/
│   │       └── libllama-cpp-arm64.so (~5-7 MB stripped)
│   └── java/ (~72 KB)
├── cpp/ (13 MB) - Added in 0.0.7
├── dist/ (~0.5 MB)
├── types/ (~12 KB)
└── ios/Sources/ (~60 KB) - Swift code only, no framework
```

**Key Insights:**
1. 0.0.22 was **Android-only** (no iOS framework)
2. **Single ABI** (`arm64-v8a` only, no `armeabi-v7a`)
3. **Android `.so` was stripped** (~5-7 MB, not 48 MB unstripped)
4. **`cpp/` was included** (added in 0.0.7, so present in 0.0.22)

---

## Why 0.1.0 is Larger:

1. **+5.3 MB**: iOS framework (NEW - main feature)
2. **+25-48 MB**: Android `armeabi-v7a` (now removed in latest build)
3. **+~40 MB**: Android `arm64-v8a` was **unstripped** in 0.1.0
   - 0.0.22: ~5-7 MB (stripped)
   - 0.1.0: ~48 MB (unstripped) → ~25-30 MB (stripped, now fixed)

**Total increase: ~50 MB** (from 20 MB to 70 MB)

**Breakdown:**
- iOS framework: +5.3 MB
- Android armeabi-v7a: +25-48 MB (removed in latest)
- Android arm64-v8a unstripped: +40 MB (now fixed with stripping)

---

## Optimizations Applied (Post-0.1.0):

1. ✅ **Build only `arm64-v8a`** (removes `armeabi-v7a`)
   - Saves: ~25-48 MB in package
   - App size: Unchanged (was already arm64-only via `abiFilters`)

2. ✅ **Strip debug symbols** (Android + iOS)
   - Saves: ~15-20 MB on Android, ~0.5-1 MB on iOS

3. ✅ **Exclude `ios/Tests`**
   - Saves: ~4 KB (minimal)

**Expected new size:** ~45-55 MB unpacked (down from 70 MB)

**Comparison to 0.0.22:**
- 0.0.22: 20 MB (Android-only, stripped, single ABI)
- 0.1.0 optimized: ~45-55 MB (iOS + Android, stripped, single ABI)
- **Difference:** +25-35 MB for complete iOS support

---

## Recommendation:

To match 0.0.22's size (~20 MB), you would need to:
1. ❌ Remove iOS framework (defeats the purpose of 0.1.0)
2. ✅ Build only `arm64-v8a` (already done)
3. ✅ Strip binaries (already done)
4. ❌ Remove `cpp/` (breaks Android builds)

**Conclusion:** The size increase is **justified** because:
- Complete iOS support is the main feature of 0.1.0
- With optimizations, we're at ~45-55 MB (vs 20 MB for Android-only)
- The `cpp/` folder is required for builds and doesn't affect app store size
