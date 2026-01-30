# npm Publish Guide - 2FA Setup

## Issue
```
npm error 403 403 Forbidden - Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

## Solution Options

### Option 1: Enable 2FA on npm Account (Recommended)

1. **Enable 2FA on npm website:**
   - Go to https://www.npmjs.com/settings/[your-username]/security
   - Click "Enable 2FA" or "Edit" next to Two-Factor Authentication
   - Choose "Authorization and Publishing" (required for publishing)
   - Follow the setup instructions (use an authenticator app like Google Authenticator, Authy, or 1Password)

2. **After enabling 2FA, publish:**
   ```bash
   npm publish
   ```
   - npm will prompt for your OTP (one-time password) from your authenticator app

### Option 2: Use Granular Access Token (Alternative)

1. **Create a granular access token:**
   - Go to https://www.npmjs.com/settings/[your-username]/tokens
   - Click "Generate New Token"
   - Select "Granular Access Token"
   - Name it (e.g., "llama-cpp-publish")
   - Set expiration (or "No expiration" for CI/CD)
   - **Important:** Enable "Bypass 2FA" permission
   - Select package: `llama-cpp-capacitor`
   - Select permissions: `Read and Publish`
   - Click "Generate Token"
   - **Copy the token immediately** (you won't see it again!)

2. **Configure npm to use the token:**
   ```bash
   # Option A: Add to .npmrc in project root
   echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN_HERE" > .npmrc
   
   # Option B: Add globally (less secure)
   npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN_HERE
   
   # Option C: Use environment variable (most secure for CI/CD)
   export NPM_TOKEN=YOUR_TOKEN_HERE
   ```

3. **Publish:**
   ```bash
   npm publish
   ```

### Option 3: Use Legacy Auth Token (Not Recommended)

If you have an older token, you can use it, but npm is phasing out classic tokens:

```bash
npm config set //registry.npmjs.org/:_authToken YOUR_LEGACY_TOKEN
npm publish
```

## Verify Authentication

Before publishing, verify you're logged in:

```bash
npm whoami
```

Should show your npm username (e.g., `annadata`).

## Build and pack (what gets published)

Before publishing, ensure all necessary artifacts are built and included:

1. **JavaScript/TypeScript** (always): `npm run build` runs automatically before publish (`prepublishOnly`). It:
   - Cleans `dist/`
   - Runs docgen → `dist/docs.json` + README
   - Compiles TypeScript → `dist/esm/*.js` (and `.d.ts`)
   - Bundles with Rollup → `dist/plugin.js`, `dist/plugin.cjs.js` + sourcemaps

2. **Native libraries** (optional but recommended for full package): Run `npm run build:all` to also build:
   - iOS: `ios/Frameworks/llama-cpp.framework`
   - Android: `android/src/main/jniLibs/<abi>/libllama-cpp-*.so`  
   Requires macOS (Xcode) for iOS and Android SDK/NDK for Android. If you skip this, consumers can build native themselves using `npm run build:native` after install.

3. **Verify what will be packed**: Run `npm run pack` (JS only) or `npm run pack:full` (JS + native) to see the file list without publishing.

**Included in the package** (`package.json` "files"):
- `dist/` (plugin bundles, ESM, docs.json)
- `types/` (TypeScript declarations)
- `android/src/main/`, `android/build.gradle`
- `ios/Sources`, `ios/Frameworks`, `ios/CMakeLists*.txt`
- `cpp/`, `build-native.sh`, `Package.swift`, `LlamaCpp.podspec`

## Publish Command

Once 2FA is enabled or token is configured:

```bash
cd /path/to/llama-cpp

# 1. Build JS (runs again automatically on publish)
npm run build

# 2. (Optional) Build native libs so they are included in the tarball
npm run build:all

# 3. Verify what will be packed
npm run pack
# or with native: npm run pack:full

# 4. Publish
npm publish
```

## Troubleshooting

### If you get "403 Forbidden" after enabling 2FA:
- Make sure you selected "Authorization and Publishing" (not just "Authorization")
- Try logging out and back in: `npm logout` then `npm login`

### If using a token and still getting 403:
- Verify the token has "Bypass 2FA" enabled
- Check token hasn't expired
- Ensure token has "Publish" permission for `llama-cpp-capacitor`

### If you need to check current auth:
```bash
npm config get //registry.npmjs.org/:_authToken
# Should show your token (or nothing if using 2FA)
```

## Security Notes

- **Never commit `.npmrc` with tokens to git** - add `.npmrc` to `.gitignore`
- Use granular tokens with minimal permissions
- Set token expiration dates when possible
- For CI/CD, use environment variables or secrets management
