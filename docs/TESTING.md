# LlamaCpp Integration Testing Guide

## 🧪 **Overview**

This document provides comprehensive guidance for running integration tests with actual GGUF models to validate the complete llama-cpp Capacitor plugin implementation.

## 📋 **Test Structure**

```
test/
├── integration/
│   ├── llama-cpp.test.ts          # Main integration tests
│   ├── test-runner.ts             # Custom test runner
│   ├── setup.ts                   # Test setup and utilities
│   └── jest.integration.config.js # Jest configuration
├── models/                        # Test model storage
├── images/                        # Test image files
├── audio/                         # Test audio files
├── output/                        # Test results and reports
│   ├── logs/                      # Test logs
│   ├── results/                   # Test results
│   ├── reports/                   # Generated reports
│   └── sessions/                  # Session files
└── coverage/                      # Code coverage reports
```

## 🚀 **Quick Start**

### **1. Prerequisites**

- Node.js 16+ and npm
- Jest testing framework
- TypeScript compiler
- curl or wget (for model downloads)
- At least 10GB free disk space (for models)

### **2. Install Dependencies**

```bash
npm install
npm install --save-dev jest ts-jest @types/jest jest-junit
```

### **3. Run Integration Tests**

```bash
# Run all integration tests (downloads models automatically)
npm run test:integration

# Run only Jest tests
npm run test:integration:jest

# Run only custom test runner
npm run test:integration:custom
```

## 📦 **Test Models**

The integration tests use the following GGUF models:

### **Required Models**

| Model | Size | URL | Purpose |
|-------|------|-----|---------|
| `llama-2-7b-chat.Q4_K_M.gguf` | 4.37 GB | [Download](https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf) | Basic testing |
| `llava-1.5-7b-Q4_K_M.gguf` | 4.37 GB | [Download](https://huggingface.co/TheBloke/llava-v1.5-7B-GGUF/resolve/main/llava-1.5-7b-Q4_K_M.gguf) | Multimodal testing |

### **Manual Model Setup**

If automatic download fails, manually download models:

```bash
# Create models directory
mkdir -p test/models

# Download models manually
curl -L -o test/models/llama-2-7b-chat.Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf"

curl -L -o test/models/llava-1.5-7b-Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/llava-v1.5-7B-GGUF/resolve/main/llava-1.5-7b-Q4_K_M.gguf"
```

## 🧪 **Test Categories**

### **1. Core Functionality Tests**

#### **Model Initialization**
- ✅ Model loading and validation
- ✅ Parameter validation
- ✅ Context management
- ✅ Error handling for invalid models

#### **Text Completion**
- ✅ Basic text generation
- ✅ Streaming completion
- ✅ Parameter tuning (temperature, top_p, etc.)
- ✅ Stop completion functionality

#### **Chat Conversations**
- ✅ Multi-turn conversations
- ✅ Message formatting
- ✅ Chat template processing
- ✅ Context preservation

#### **Tokenization**
- ✅ Text tokenization
- ✅ Token detokenization
- ✅ Token counting
- ✅ Media token handling

### **2. Advanced Feature Tests**

#### **Embeddings**
- ✅ Vector embedding generation
- ✅ Embedding dimensions
- ✅ Semantic similarity

#### **Session Management**
- ✅ Session saving
- ✅ Session loading
- ✅ Context restoration

#### **Performance Benchmarking**
- ✅ Speed measurements
- ✅ Memory usage tracking
- ✅ Multi-threading tests

#### **LoRA Adapters**
- ✅ Adapter application
- ✅ Adapter removal
- ✅ Adapter listing

### **3. Multimodal Tests**

#### **Image Processing**
- ✅ Image loading and validation
- ✅ Image description generation
- ✅ Multi-image processing

#### **Audio Processing**
- ✅ Audio file handling
- ✅ Audio completion
- ✅ TTS functionality

### **4. Error Handling Tests**

#### **Invalid Inputs**
- ✅ Invalid model paths
- ✅ Invalid parameters
- ✅ Malformed requests

#### **Resource Management**
- ✅ Memory leaks
- ✅ Context cleanup
- ✅ Resource limits

## 🔧 **Test Configuration**

### **Environment Variables**

```bash
# Model paths
export TEST_MODEL_SMALL="test/models/llama-2-7b-chat.Q4_K_M.gguf"
export TEST_MODEL_MULTIMODAL="test/models/llava-1.5-7b-Q4_K_M.gguf"

# Timeouts (in milliseconds)
export TEST_TIMEOUT_MODEL_LOAD=30000
export TEST_TIMEOUT_COMPLETION=15000
export TEST_TIMEOUT_EMBEDDING=10000
export TEST_TIMEOUT_TTS=20000
```

### **Jest Configuration**

```javascript
// test/jest.integration.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 60000,
  verbose: true,
  collectCoverage: true,
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  }
};
```

## 📊 **Test Results and Reporting**

### **Generated Reports**

After running tests, the following reports are generated:

1. **Jest Report**: `test/output/junit.xml`
2. **Custom Test Report**: `test/output/results/test-report.json`
3. **Performance Logs**: `test/output/logs/performance.json`
4. **Test Results**: `test/output/logs/test-results.json`
5. **Coverage Report**: `test/coverage/`

### **Report Analysis**

```bash
# View test results
cat test/output/results/test-report.json | jq '.'

# View performance data
cat test/output/logs/performance.json | jq '.'

# View coverage report
open test/coverage/lcov-report/index.html
```

## 🚀 **Advanced Testing Scenarios**

### **1. Stress Testing**

```typescript
// Test concurrent model loading
test('should handle multiple concurrent contexts', async () => {
  const contexts = [];
  for (let i = 0; i < 5; i++) {
    contexts.push(initLlama({
      model: TEST_CONFIG.modelPath,
      n_ctx: 1024
    }));
  }
  
  const results = await Promise.all(contexts);
  expect(results).toHaveLength(5);
  
  // Cleanup
  await Promise.all(results.map(ctx => ctx.release()));
});
```

### **2. Memory Testing**

```typescript
// Test memory usage
test('should not leak memory', async () => {
  const initialMemory = process.memoryUsage();
  
  for (let i = 0; i < 10; i++) {
    const context = await initLlama({
      model: TEST_CONFIG.modelPath,
      n_ctx: 2048
    });
    
    await context.completion({
      prompt: "Test memory usage",
      n_predict: 100
    });
    
    await context.release();
  }
  
  const finalMemory = process.memoryUsage();
  const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
  
  // Memory increase should be reasonable (< 100MB)
  expect(memoryIncrease).toBeLessThan(100 * 1024 * 1024);
});
```

### **3. Performance Testing**

```typescript
// Test completion speed
test('should complete text within reasonable time', async () => {
  const startTime = Date.now();
  
  const result = await context.completion({
    prompt: "Hello world",
    n_predict: 50
  });
  
  const duration = Date.now() - startTime;
  
  // Should complete within 10 seconds
  expect(duration).toBeLessThan(10000);
  expect(result.text).toBeDefined();
});
```

## 🔍 **Debugging Tests**

### **1. Enable Verbose Logging**

```bash
# Enable native logging
export LLAMA_CPP_VERBOSE=1

# Run tests with verbose output
npm run test:integration -- --verbose
```

### **2. Debug Specific Tests**

```bash
# Run specific test file
npm run test:integration:jest -- --testNamePattern="Model Initialization"

# Run specific test case
npm run test:integration:jest -- --testNamePattern="should initialize model successfully"
```

### **3. Debug Model Loading**

```typescript
// Add debug logging to tests
test('should initialize model successfully', async () => {
  console.log('Starting model initialization...');
  
  const context = await initLlama({
    model: TEST_CONFIG.modelPath,
    n_ctx: 2048
  });
  
  console.log('Model initialized:', context.model);
  console.log('Context ID:', context.contextId);
  
  expect(context).toBeDefined();
});
```

## 🐛 **Common Issues and Solutions**

### **1. Model Download Issues**

**Problem**: Models fail to download
**Solution**: 
```bash
# Check network connectivity
curl -I https://huggingface.co

# Download manually
wget https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf
```

### **2. Memory Issues**

**Problem**: Tests fail due to insufficient memory
**Solution**:
```bash
# Reduce model context size
export TEST_MODEL_CTX=1024

# Use smaller models for testing
export TEST_MODEL_SMALL="test/models/llama-2-7b-chat.Q4_0.gguf"
```

### **3. Timeout Issues**

**Problem**: Tests timeout
**Solution**:
```bash
# Increase timeouts
export TEST_TIMEOUT_MODEL_LOAD=60000
export TEST_TIMEOUT_COMPLETION=30000

# Run tests with longer timeout
npm run test:integration:jest -- --testTimeout=120000
```

## 📈 **Continuous Integration**

### **GitHub Actions Example**

```yaml
name: Integration Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Download test models
        run: |
          mkdir -p test/models
          curl -L -o test/models/llama-2-7b-chat.Q4_K_M.gguf \
            "https://huggingface.co/TheBloke/Llama-2-7B-Chat-GGUF/resolve/main/llama-2-7b-chat.Q4_K_M.gguf"
      
      - name: Run integration tests
        run: npm run test:integration:jest
      
      - name: Upload test results
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test/output/
```

## 🎯 **Best Practices**

### **1. Test Organization**
- Group related tests in describe blocks
- Use descriptive test names
- Keep tests independent and isolated

### **2. Resource Management**
- Always clean up contexts after tests
- Use appropriate timeouts
- Monitor memory usage

### **3. Error Handling**
- Test both success and failure scenarios
- Validate error messages
- Test edge cases

### **4. Performance**
- Measure and log performance metrics
- Set realistic performance expectations
- Test with different model sizes

## 📚 **Additional Resources**

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [TypeScript Testing](https://www.typescriptlang.org/docs/handbook/testing.html)
- [llama.cpp Documentation](https://github.com/ggerganov/llama.cpp)
- [Capacitor Plugin Testing](https://capacitorjs.com/docs/plugins/testing)

---

**Note**: These integration tests require significant computational resources and may take several minutes to complete. Ensure you have adequate hardware and storage space before running the full test suite.
