# App Store Size Guide

This document explains **what affects iOS/Android app size** when using `llama-cpp-capacitor`, what can be **removed or optimized**, and how to avoid bulky store uploads.

---

## What Actually Gets Into Your App?

| Item | In npm package? | In final app (store)? | Size |
|------|-----------------|------------------------|------|
| **iOS** `llama-cpp.framework` | ✅ | ✅ | ~5 MB (strip: ~4 MB) |
| **Android** `jniLibs/*.so` | ✅ | ✅ (only ABIs you include) | ~25–48 MB per ABI |
| **cpp/** (C++ sources) | ✅ | ❌ | 13 MB – **never in app** |
| **dist/** (TS/JS) | ✅ | ✅ (via web bundle) | ~0.5 MB |
| **ios/Sources**, **android/.../java** | ✅ | ✅ | ~0.1 MB |
| **ios/Tests** | ❌ (excluded) | ❌ | ~4 KB |

**Takeaway:** The **app store** size is dominated by the **iOS framework** and **Android `.so`** libraries. The `cpp/` folder is only for building; it is **not** bundled in the app.

---

## What You Can Remove or Change

### 1. ✅ **Build only `arm64-v8a` on Android** (saves ~25–48 MB in app)

- **Current:** Plugin builds both `arm64-v8a` and `armeabi-v7a`.  
- **Reality:** `android/build.gradle` uses `abiFilters 'arm64-v8a'`, so only arm64 is included in the app. The armeabi-v7a `.so` bloats the **npm package** but is **not** used in the app.
- **Change:** Build and ship **only** `arm64-v8a`. Drop `armeabi-v7a`.
- **Effect:** Smaller npm package; **app size unchanged** (we were already app‑only arm64).  
- **Trade-off:** No support for 32‑bit‑only devices (increasingly rare).

**Status:** Implemented in `build-native.sh` (builds only arm64-v8a).

---

### 2. ✅ **Strip debug symbols**

- **Android:** `build-native.sh` runs `llvm-strip --strip-debug` on each `.so`. Saves ~30–50% on `.so` size.
- **iOS:** Strip the framework binary (see below). Saves ~0.5–1 MB.

**Status:** Android done. iOS strip added in `build-native.sh`.

---

### 3. ❌ **Do not remove `cpp/` from the npm package**

- `cpp/` is required for the **Android** native build: `CMakeLists.txt` references `../../../cpp`.  
- If you remove `cpp/` from the published package, Android builds that use `externalNativeBuild` will **fail**.
- `cpp/` is **not** included in the app bundle; removing it would only reduce **npm package** size, not **app store** size.

**Conclusion:** Keep `cpp/` in the package.

---

### 4. **Optional: Exclude `ios/Tests` from package**

- `ios/Tests` is only used for plugin tests, not by consuming apps.
- Excluding it trims a few KB from the **npm package** only, not app size.

**Conclusion:** Optional; minimal impact.

---

### 5. **Use Android App Bundle (AAB)**

- Upload **AAB** to Play Store, not APK.
- Play Store serves **split APKs** per ABI. With only `arm64-v8a`, users get a single small download.
- **You:** Use `./gradlew bundleRelease` and upload the `.aab`.

---

### 6. **Rely on iOS App Thinning**

- The framework is built **arm64-only** (no simulator slice).  
- App Thinning will only deliver the device slice to users.

---

## Summary of Implemented Optimizations

| Optimization | Effect |
|-------------|--------|
| Build only **arm64-v8a** | No armeabi-v7a `.so` in package or app |
| **Strip** Android `.so` | ~30–50% smaller native libs |
| **Strip** iOS framework binary | ~0.5–1 MB smaller framework |
| **abiFilters** `arm64-v8a` in `build.gradle` | App already uses only arm64 |

---

## Store Limits (Reference)

- **iOS:** App Store limit 4 GB; apps > 200 MB may trigger “large app” warning and optional cellular prompt.  
- **Android:** 150 MB per APK; AAB can be larger (Play generates split APKs).

Keeping the plugin’s native slice **~5 MB (iOS) + ~25–30 MB (Android arm64)** keeps you well within store limits.

---

## For App Developers

1. Use **AAB** for Android and **App Thinning** for iOS.  
2. Ensure **Release** builds (no debug symbols in shipped binaries).  
3. If you use **ProGuard/R8** on Android, keep necessary llama‑cpp JNI symbols (avoid over‑shrinking).
