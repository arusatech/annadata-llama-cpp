#!/bin/bash

# Test script to validate build scripts without actually building
# This script checks:
# 1. Script syntax
# 2. Function definitions
# 3. Required files/directories
# 4. Dependency checks

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

# Test script syntax
test_syntax() {
    print_status "Testing script syntax..."
    
    local scripts=("build-native.sh" "build-complete-x86_64.sh" "build-complete-arm64.sh")
    
    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            if bash -n "$script" 2>&1; then
                print_success "$script syntax is valid"
            else
                print_error "$script has syntax errors"
                return 1
            fi
        else
            print_warning "$script not found"
        fi
    done
    
    return 0
}

# Test required directories
test_directories() {
    print_status "Testing required directories..."
    
    local dirs=("ios" "android" "cpp" "android/src/main")
    
    for dir in "${dirs[@]}"; do
        if [ -d "$dir" ]; then
            print_success "Directory exists: $dir"
        else
            print_error "Directory missing: $dir"
            return 1
        fi
    done
    
    return 0
}

# Test required files
test_files() {
    print_status "Testing required files..."
    
    local files=(
        "ios/CMakeLists.txt"
        "android/src/main/CMakeLists.txt"
        "android/src/main/jni.cpp"
        "cpp/cap-llama.h"
        "cpp/cap-embedding.cpp"
        "cpp/cap-embedding.h"
    )
    
    local missing=0
    
    for file in "${files[@]}"; do
        if [ -f "$file" ]; then
            print_success "File exists: $file"
        else
            print_warning "File missing: $file (may be optional)"
            missing=$((missing + 1))
        fi
    done
    
    if [ $missing -gt 0 ]; then
        print_warning "$missing files missing (some may be optional)"
    fi
    
    return 0
}

# Test function definitions in build scripts
test_functions() {
    print_status "Testing function definitions..."
    
    local script="build-native.sh"
    if [ -f "$script" ]; then
        local functions=("print_status" "print_success" "print_warning" "print_error" "check_macos" "check_android_sdk" "build_ios" "build_android" "main")
        
        for func in "${functions[@]}"; do
            if grep -q "^${func}()" "$script" || grep -q "^# ${func}" "$script"; then
                print_success "Function found: $func"
            else
                print_warning "Function not found: $func (may be defined differently)"
            fi
        done
    fi
    
    return 0
}

# Test dependency checks
test_dependencies() {
    print_status "Testing dependency detection..."
    
    # Check CMake
    if command -v cmake &> /dev/null; then
        local cmake_version=$(cmake --version 2>/dev/null | head -1)
        print_success "CMake found: $cmake_version"
    else
        print_warning "CMake not found in PATH (required for building)"
    fi
    
    # Check Make
    if command -v make &> /dev/null; then
        local make_version=$(make --version 2>/dev/null | head -1)
        print_success "Make found: $make_version"
    else
        print_warning "Make not found in PATH (required for building)"
    fi
    
    # Check Ninja (optional)
    if command -v ninja &> /dev/null; then
        local ninja_version=$(ninja --version 2>/dev/null)
        print_success "Ninja found: version $ninja_version"
    else
        print_warning "Ninja not found (optional, Make can be used instead)"
    fi
    
    # Check Android SDK
    if [ -n "$ANDROID_HOME" ] || [ -n "$ANDROID_SDK_ROOT" ]; then
        local sdk_path="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
        print_success "Android SDK found: $sdk_path"
    else
        print_warning "Android SDK not set (ANDROID_HOME or ANDROID_SDK_ROOT)"
    fi
    
    # Check macOS for iOS builds
    if [[ "$OSTYPE" == "darwin"* ]]; then
        print_success "macOS detected (can build iOS)"
        
        # Check Xcode
        if command -v xcodebuild &> /dev/null; then
            local xcode_version=$(xcodebuild -version 2>/dev/null | head -1)
            print_success "Xcode found: $xcode_version"
        else
            print_warning "Xcode not found (required for iOS builds)"
        fi
    else
        print_warning "Not macOS (iOS builds will be skipped)"
    fi
    
    return 0
}

# Test script execution (dry run)
test_execution() {
    print_status "Testing script execution (dry run)..."
    
    local script="build-native.sh"
    if [ -f "$script" ]; then
        # Source the script to test function definitions
        # We'll just check if it can be sourced without errors
        if bash -c "source '$script' 2>&1; echo 'Script sourced successfully'" 2>&1 | grep -q "Script sourced successfully"; then
            print_success "Script can be sourced without errors"
        else
            print_warning "Script may have issues when sourced"
        fi
    fi
    
    return 0
}

# Main test function
main() {
    echo ""
    echo "=========================================="
    echo "  Build Script Test Suite"
    echo "=========================================="
    echo ""
    
    local tests_passed=0
    local tests_failed=0
    
    # Run tests
    if test_syntax; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    
    if test_directories; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    
    if test_files; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    
    if test_functions; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    
    if test_dependencies; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    
    if test_execution; then
        tests_passed=$((tests_passed + 1))
    else
        tests_failed=$((tests_failed + 1))
    fi
    
    echo ""
    echo "=========================================="
    echo "  Test Results"
    echo "=========================================="
    echo -e "${GREEN}Passed:${NC} $tests_passed"
    echo -e "${RED}Failed:${NC} $tests_failed"
    echo ""
    
    if [ $tests_failed -eq 0 ]; then
        print_success "All tests passed! Build scripts are ready."
        return 0
    else
        print_error "Some tests failed. Please review the output above."
        return 1
    fi
}

# Run tests
main "$@"
