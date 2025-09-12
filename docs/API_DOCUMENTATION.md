# LlamaCpp Capacitor Plugin API Documentation

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [Core Concepts](#core-concepts)
4. [API Reference](#api-reference)
   - [Initialization](#initialization)
   - [Context Management](#context-management)
   - [Text Completion](#text-completion)
   - [Chat Conversations](#chat-conversations)
   - [Tokenization](#tokenization)
   - [Embeddings](#embeddings)
   - [Reranking](#reranking)
   - [Multimodal Support](#multimodal-support)
   - [Text-to-Speech (TTS)](#text-to-speech-tts)
   - [LoRA Adapters](#lora-adapters)
   - [Session Management](#session-management)
   - [Benchmarking](#benchmarking)
   - [Utilities](#utilities)
5. [Configuration Options](#configuration-options)
6. [Examples](#examples)
7. [Error Handling](#error-handling)
8. [Platform Support](#platform-support)

## Installation

```bash
npm install llama-cpp-capacitor
```

## Quick Start

```typescript
import { initLlama, LlamaContext } from 'llama-cpp-capacitor';

// Initialize a model
const context = await initLlama({
  model: '/path/to/model.gguf',
  n_ctx: 2048,
  n_threads: 4
});

// Generate text
const result = await context.completion({
  prompt: "Hello, how are you?",
  n_predict: 100
});

console.log(result.text);

// Clean up
await context.release();
```

## Core Concepts

### LlamaContext
The main interface for interacting with a loaded model. Each context represents an isolated instance of a model with its own memory and state.

### Model Formats
- **GGUF**: The primary format supported by llama.cpp
- **Quantized Models**: Q4_K_M, Q5_K_M, etc. for reduced memory usage
- **Multimodal Models**: Support for image and audio processing

### Platform Support
- **iOS**: Native Metal acceleration support
- **Android**: Native JNI implementation
- **Web**: Fallback implementation (limited functionality)

## API Reference

### Initialization

#### `initLlama(params: ContextParams, onProgress?: (progress: number) => void): Promise<LlamaContext>`

Initialize a llama.cpp model and create a context.

**Parameters:**
- `params`: Configuration parameters for the model
- `onProgress`: Optional callback for loading progress (0-100)

**Returns:** Promise resolving to a `LlamaContext` instance

**Example:**
```typescript
const context = await initLlama({
  model: '/path/to/llama-2-7b-chat.Q4_K_M.gguf',
  n_ctx: 2048,
  n_threads: 4,
  n_gpu_layers: 0,
  use_mlock: false,
  use_mmap: true
}, (progress) => {
  console.log(`Loading: ${progress}%`);
});
```

#### `releaseAllLlama(): Promise<void>`

Release all contexts and free memory.

**Example:**
```typescript
await releaseAllLlama();
```

### Context Management

#### `context.release(): Promise<void>`

Release the context and free associated memory.

**Example:**
```typescript
await context.release();
```

#### `context.model`

Access model information.

**Properties:**
- `desc`: Model description
- `size`: Model size in bytes
- `nEmbd`: Embedding dimension
- `nParams`: Number of parameters
- `chatTemplates`: Supported chat templates
- `metadata`: Model metadata

**Example:**
```typescript
console.log('Model:', context.model.desc);
console.log('Size:', context.model.size);
console.log('GPU available:', context.gpu);
```

### Text Completion

#### `context.completion(params: CompletionParams, callback?: (data: TokenData) => void): Promise<NativeCompletionResult>`

Generate text completion based on a prompt or messages.

**Parameters:**
- `params`: Completion parameters

#### `context.chat(options: ChatOptions): Promise<NativeCompletionResult>`

**NEW**: Chat-first method that combines message formatting and completion (like llama-cli -sys).

**Parameters:**
- `contextId`: Context ID
- `messages`: Array of chat messages
- `system`: Optional system prompt (like llama-cli -sys)
- `chatTemplate`: Optional chat template override
- `params`: Additional completion parameters

**Example:**
```typescript
const result = await llama.chat({
  contextId: 1,
  messages: [
    { role: "user", content: "What is 2+2?" }
  ],
  system: "You are a helpful assistant",
  params: { n_predict: 100 }
});
```

#### `context.chatWithSystem(options: ChatWithSystemOptions): Promise<NativeCompletionResult>`

**NEW**: Simple chat with system prompt (equivalent to llama-cli -sys "You are a helpful assistant").

**Parameters:**
- `contextId`: Context ID
- `system`: System prompt
- `message`: User message
- `params`: Additional completion parameters

**Example:**
```typescript
const result = await llama.chatWithSystem({
  contextId: 1,
  system: "You are a helpful assistant",
  message: "What is 2+2?",
  params: { n_predict: 100 }
});
```

#### `context.generateText(options: GenerateTextOptions): Promise<NativeCompletionResult>`

**NEW**: Simple text generation (equivalent to llama-cli -p "prompt").

**Parameters:**
- `contextId`: Context ID
- `prompt`: Text prompt
- `params`: Additional completion parameters

**Example:**
```typescript
const result = await llama.generateText({
  contextId: 1,
  prompt: "I believe the meaning of life is",
  params: { n_predict: 128 }
});
```
- `callback`: Optional streaming callback for token-by-token output

**Returns:** Promise resolving to completion result

**Example - Basic Completion:**
```typescript
const result = await context.completion({
  prompt: "Write a short story about a robot:",
  n_predict: 100,
  temperature: 0.8,
  top_p: 0.9,
  top_k: 40
});

console.log(result.text);
```

**Example - Streaming Completion:**
```typescript
let fullText = '';
const result = await context.completion({
  prompt: "Explain quantum computing:",
  n_predict: 200
}, (tokenData) => {
  fullText += tokenData.token;
  process.stdout.write(tokenData.token);
});

console.log('\nFinal result:', result.text);
```

**Example - Chat Completion:**
```typescript
const result = await context.completion({
  messages: [
    { role: "system", content: "You are a helpful AI assistant." },
    { role: "user", content: "What is the capital of France?" }
  ],
  n_predict: 100,
  temperature: 0.7
});

console.log(result.content);
```

#### `context.stopCompletion(): Promise<void>`

Stop the current completion generation.

**Example:**
```typescript
// Start completion
const completionPromise = context.completion({
  prompt: "Write a very long story:",
  n_predict: 1000
});

// Stop after 2 seconds
setTimeout(async () => {
  await context.stopCompletion();
}, 2000);

const result = await completionPromise;
```

### Chat Conversations

#### `context.getFormattedChat(messages: LlamaCppOAICompatibleMessage[], template?: string, params?: object): Promise<FormattedChatResult>`

Format messages for chat completion.

**Example:**
```typescript
const formatted = await context.getFormattedChat([
  { role: "user", content: "Hello!" },
  { role: "assistant", content: "Hi there!" },
  { role: "user", content: "How are you?" }
]);

console.log(formatted.prompt);
```

### Tokenization

#### `context.tokenize(text: string, options?: { media_paths?: string[] }): Promise<NativeTokenizeResult>`

Tokenize text into tokens.

**Example:**
```typescript
const result = await context.tokenize("Hello, world!");
console.log('Tokens:', result.tokens);
console.log('Has images:', result.has_images);
```

#### `context.detokenize(tokens: number[]): Promise<string>`

Convert tokens back to text.

**Example:**
```typescript
const tokens = [1, 2, 3, 4, 5];
const text = await context.detokenize(tokens);
console.log('Text:', text);
```

### Embeddings

#### `context.embedding(text: string, params?: EmbeddingParams): Promise<NativeEmbeddingResult>`

Generate embeddings for text.

**Example:**
```typescript
const result = await context.embedding("Hello, world!", {
  embd_normalize: 1.0
});

console.log('Embedding length:', result.embedding.length);
console.log('First 5 values:', result.embedding.slice(0, 5));
```

### Reranking

#### `context.rerank(query: string, documents: string[], params?: RerankParams): Promise<RerankResult[]>`

Rank documents by relevance to a query.

**Example:**
```typescript
const documents = [
  "Document about cats and their behavior",
  "Document about dogs and training methods",
  "Document about birds and migration patterns"
];

const results = await context.rerank("Tell me about pets", documents, {
  normalize: 1.0
});

results.forEach((result, index) => {
  console.log(`${index + 1}. Score: ${result.score.toFixed(3)}, Document: ${result.document}`);
});
```

### Multimodal Support

#### `context.initMultimodal(params: { path: string; use_gpu?: boolean }): Promise<boolean>`

Initialize multimodal support with a projector file.

**Example:**
```typescript
const success = await context.initMultimodal({
  path: '/path/to/mmproj.gguf',
  use_gpu: true
});

if (success) {
  console.log('Multimodal support initialized');
}
```

#### `context.isMultimodalEnabled(): Promise<boolean>`

Check if multimodal support is enabled.

#### `context.getMultimodalSupport(): Promise<{ vision: boolean; audio: boolean }>`

Get multimodal capabilities.

#### `context.releaseMultimodal(): Promise<void>`

Release multimodal resources.

**Example - Image Processing:**
```typescript
// Initialize multimodal
await context.initMultimodal({
  path: '/path/to/mmproj.gguf',
  use_gpu: true
});

// Process image with text
const result = await context.completion({
  messages: [
    { 
      role: "user", 
      content: [
        { type: "text", text: "What do you see in this image?" },
        { type: "image_url", image_url: { url: "file:///path/to/image.jpg" } }
      ]
    }
  ],
  n_predict: 100
});

console.log('Image analysis:', result.content);
```

### Text-to-Speech (TTS)

#### `context.initVocoder(params: { path: string; n_batch?: number }): Promise<boolean>`

Initialize TTS with a vocoder model.

**Example:**
```typescript
const success = await context.initVocoder({
  path: '/path/to/vocoder.gguf',
  n_batch: 512
});

if (success) {
  console.log('TTS initialized');
}
```

#### `context.isVocoderEnabled(): Promise<boolean>`

Check if TTS is enabled.

#### `context.getFormattedAudioCompletion(speaker: object | null, textToSpeak: string): Promise<{ prompt: string; grammar?: string }>`

Get formatted audio completion prompt.

#### `context.getAudioCompletionGuideTokens(textToSpeak: string): Promise<Array<number>>`

Get guide tokens for audio completion.

#### `context.decodeAudioTokens(tokens: number[]): Promise<Array<number>>`

Decode audio tokens to audio data.

#### `context.releaseVocoder(): Promise<void>`

Release TTS resources.

**Example - TTS Generation:**
```typescript
// Initialize TTS
await context.initVocoder({
  path: '/path/to/vocoder.gguf',
  n_batch: 512
});

// Generate audio completion
const audioCompletion = await context.getFormattedAudioCompletion(
  null, // Speaker configuration
  "Hello, this is a test of text-to-speech functionality."
);

// Get guide tokens
const guideTokens = await context.getAudioCompletionGuideTokens(
  "Hello, this is a test of text-to-speech functionality."
);

// Generate audio tokens
const audioResult = await context.completion({
  prompt: audioCompletion.prompt,
  grammar: audioCompletion.grammar,
  guide_tokens: guideTokens,
  n_predict: 1000
});

// Decode to audio data
if (audioResult.audio_tokens) {
  const audioData = await context.decodeAudioTokens(audioResult.audio_tokens);
  console.log('Audio data length:', audioData.length);
}
```

### LoRA Adapters

#### `context.applyLoraAdapters(loraList: Array<{ path: string; scaled?: number }>): Promise<void>`

Apply LoRA adapters to the model.

**Example:**
```typescript
await context.applyLoraAdapters([
  { path: '/path/to/adapter1.gguf', scaled: 1.0 },
  { path: '/path/to/adapter2.gguf', scaled: 0.5 }
]);
```

#### `context.removeLoraAdapters(): Promise<void>`

Remove all LoRA adapters.

#### `context.getLoadedLoraAdapters(): Promise<Array<{ path: string; scaled?: number }>>`

Get list of loaded LoRA adapters.

**Example:**
```typescript
// Apply adapters
await context.applyLoraAdapters([
  { path: '/path/to/adapter.gguf', scaled: 1.0 }
]);

// Check loaded adapters
const adapters = await context.getLoadedLoraAdapters();
console.log('Loaded adapters:', adapters);

// Generate with adapters
const result = await context.completion({
  prompt: "Test prompt with LoRA adapters:",
  n_predict: 50
});

// Remove adapters
await context.removeLoraAdapters();
```

### Session Management

#### `context.saveSession(filepath: string, options?: { tokenSize: number }): Promise<number>`

Save current session to a file.

**Example:**
```typescript
const tokensSaved = await context.saveSession('/path/to/session.gguf', { 
  tokenSize: 1000 
});
console.log('Session saved, tokens:', tokensSaved);
```

#### `context.loadSession(filepath: string): Promise<NativeSessionLoadResult>`

Load session from a file.

**Example:**
```typescript
const session = await context.loadSession('/path/to/session.gguf');
console.log('Session loaded, tokens:', session.tokens_loaded);
console.log('Previous prompt:', session.prompt);
```

### Benchmarking

#### `context.bench(pp: number, tg: number, pl: number, nr: number): Promise<BenchResult>`

Benchmark model performance.

**Example:**
```typescript
const benchResult = await context.bench(128, 128, 128, 10);
console.log('Benchmark result:', benchResult);
```

### Utilities

#### `toggleNativeLog(enabled: boolean): Promise<void>`

Enable or disable native logging.

#### `addNativeLogListener(listener: (level: string, text: string) => void): { remove: () => void }`

Add a listener for native logs.

#### `setContextLimit(limit: number): Promise<void>`

Set the maximum number of contexts.

#### `loadLlamaModelInfo(model: string): Promise<Object>`

Load model information without initializing.

**Example:**
```typescript
// Enable logging
await toggleNativeLog(true);

// Add log listener
const logListener = addNativeLogListener((level, text) => {
  console.log(`[${level}] ${text}`);
});

// Load model info
const modelInfo = await loadLlamaModelInfo('/path/to/model.gguf');
console.log('Model info:', modelInfo);

// Remove listener
logListener.remove();
```

## Configuration Options

### ContextParams

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | - | Path to GGUF model file |
| `n_ctx` | number | 512 | Context size |
| `n_threads` | number | 4 | Number of threads |
| `n_gpu_layers` | number | 0 | GPU layers (iOS only) |
| `use_mlock` | boolean | false | Lock memory |
| `use_mmap` | boolean | true | Use memory mapping |
| `embedding` | boolean | false | Embedding mode |
| `cache_type_k` | string | 'f16' | KV cache type for K |
| `cache_type_v` | string | 'f16' | KV cache type for V |
| `pooling_type` | string | 'none' | Pooling type |
| `lora` | string | - | Single LoRA adapter path |
| `lora_list` | Array | - | LoRA adapter list |

### CompletionParams

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | - | Text prompt |
| `messages` | Array | - | Chat messages |
| `n_predict` | number | -1 | Max tokens to generate |
| `temperature` | number | 0.8 | Sampling temperature |
| `top_p` | number | 0.95 | Top-p sampling |
| `top_k` | number | 40 | Top-k sampling |
| `stop` | Array | [] | Stop sequences |
| `seed` | number | -1 | Random seed |
| `response_format` | object | - | Response format specification |

## Examples

### Basic Text Generation

```typescript
import { initLlama } from 'llama-cpp-capacitor';

async function generateText() {
  const context = await initLlama({
    model: '/path/to/model.gguf',
    n_ctx: 2048,
    n_threads: 4
  });

  const result = await context.completion({
    prompt: "Write a short story about a robot learning to paint:",
    n_predict: 150,
    temperature: 0.8
  });

  console.log(result.text);
  await context.release();
}
```

### Chat Conversation

```typescript
async function chatConversation() {
  const context = await initLlama({
    model: '/path/to/chat-model.gguf',
    n_ctx: 4096,
    n_threads: 4
  });

  const result = await context.completion({
    messages: [
      { role: "system", content: "You are a helpful AI assistant." },
      { role: "user", content: "What is the capital of France?" },
      { role: "assistant", content: "The capital of France is Paris." },
      { role: "user", content: "Tell me more about it." }
    ],
    n_predict: 100,
    temperature: 0.7
  });

  console.log(result.content);
  await context.release();
}
```

### Streaming Generation

```typescript
async function streamingGeneration() {
  const context = await initLlama({
    model: '/path/to/model.gguf',
    n_ctx: 2048
  });

  let fullText = '';
  const result = await context.completion({
    prompt: "Explain quantum computing in simple terms:",
    n_predict: 200,
    temperature: 0.8
  }, (tokenData) => {
    fullText += tokenData.token;
    process.stdout.write(tokenData.token);
  });

  console.log('\nFinal result:', result.text);
  await context.release();
}
```

### Multimodal Processing

```typescript
async function processImage() {
  const context = await initLlama({
    model: '/path/to/multimodal-model.gguf',
    n_ctx: 2048
  });

  // Initialize multimodal support
  await context.initMultimodal({
    path: '/path/to/mmproj.gguf',
    use_gpu: true
  });

  // Process image
  const result = await context.completion({
    messages: [
      { 
        role: "user", 
        content: [
          { type: "text", text: "What do you see in this image?" },
          { type: "image_url", image_url: { url: "file:///path/to/image.jpg" } }
        ]
      }
    ],
    n_predict: 100
  });

  console.log('Image analysis:', result.content);
  await context.releaseMultimodal();
  await context.release();
}
```

### Structured Output

```typescript
async function structuredOutput() {
  const context = await initLlama({
    model: '/path/to/model.gguf',
    n_ctx: 2048
  });

  const result = await context.completion({
    prompt: "Generate a JSON object with a person's name, age, and favorite color:",
    n_predict: 100,
    response_format: {
      type: 'json_schema',
      json_schema: {
        strict: true,
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
            favorite_color: { type: 'string' }
          },
          required: ['name', 'age', 'favorite_color']
        }
      }
    }
  });

  console.log('Structured output:', result.content);
  await context.release();
}
```

## Error Handling

The plugin throws errors for various conditions. Always wrap calls in try-catch blocks:

```typescript
try {
  const context = await initLlama({
    model: '/path/to/model.gguf',
    n_ctx: 2048
  });

  const result = await context.completion({
    prompt: "Hello",
    n_predict: 50
  });

  console.log(result.text);
  await context.release();
} catch (error) {
  console.error('Error:', error.message);
}
```

Common error scenarios:
- Model file not found
- Insufficient memory
- Invalid parameters
- GPU not available
- Multimodal not initialized

## Platform Support

| Feature | iOS | Android | Web |
|---------|-----|---------|-----|
| Text Generation | ✅ | ✅ | ❌ |
| Chat Conversations | ✅ | ✅ | ❌ |
| Streaming | ✅ | ✅ | ❌ |
| Multimodal | ✅ | ✅ | ❌ |
| TTS | ✅ | ✅ | ❌ |
| LoRA Adapters | ✅ | ✅ | ❌ |
| Embeddings | ✅ | ✅ | ❌ |
| Reranking | ✅ | ✅ | ❌ |
| Session Management | ✅ | ✅ | ❌ |
| Benchmarking | ✅ | ✅ | ❌ |

### Platform-Specific Notes

**iOS:**
- Metal GPU acceleration support
- Set `n_gpu_layers` for GPU usage
- Models should be in app bundle or documents directory

**Android:**
- Native JNI implementation
- Models should be in app's internal storage
- Supports multiple CPU architectures

**Web:**
- Limited functionality
- Most native features not available
- Use for development/testing only

## Performance Tips

1. **Use quantized models** (Q4_K_M, Q5_K_M) for better memory efficiency
2. **Adjust context size** based on your use case
3. **Enable GPU acceleration** on iOS for better performance
4. **Use appropriate thread count** for your device
5. **Monitor memory usage** with `use_mlock: false`
6. **Use streaming** for long generations to show progress
7. **Release contexts** when done to free memory

## Troubleshooting

### Common Issues

1. **Model not found**: Ensure the model path is correct and file exists
2. **Out of memory**: Try using a quantized model or reducing `n_ctx`
3. **Slow performance**: Enable GPU acceleration or increase `n_threads`
4. **Multimodal not working**: Ensure the mmproj file is compatible with your model

### Debugging

Enable native logging to see detailed information:

```typescript
import { toggleNativeLog, addNativeLogListener } from 'llama-cpp-capacitor';

await toggleNativeLog(true);

const logListener = addNativeLogListener((level, text) => {
  console.log(`[${level}] ${text}`);
});
```

This documentation covers the complete API for the llama-cpp Capacitor plugin. For more examples and advanced usage, refer to the `example.ts` file in the project repository.
