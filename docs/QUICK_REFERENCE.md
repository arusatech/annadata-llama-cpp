# LlamaCpp Capacitor Plugin - Quick Reference

## Installation

```bash
npm install llama-cpp-capacitor
```

## Basic Usage

```typescript
import { initLlama, LlamaContext } from 'llama-cpp-capacitor';

// Initialize model
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
await context.release();
```

## API Quick Reference

### Initialization

| Function | Description |
|----------|-------------|
| `initLlama(params, onProgress?)` | Initialize model and create context |
| `releaseAllLlama()` | Release all contexts |

### Context Methods

| Method | Description |
|--------|-------------|
| `context.release()` | Release context |
| `context.completion(params, callback?)` | Generate text completion |
| `context.stopCompletion()` | Stop current generation |
| `context.tokenize(text, options?)` | Tokenize text |
| `context.detokenize(tokens)` | Convert tokens to text |
| `context.embedding(text, params?)` | Generate embeddings |
| `context.rerank(query, documents, params?)` | Rank documents |

### Chat & Messages

```typescript
// Chat completion
const result = await context.completion({
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello!" }
  ],
  n_predict: 100
});

// Streaming
await context.completion({
  prompt: "Tell a story:",
  n_predict: 200
}, (tokenData) => {
  process.stdout.write(tokenData.token);
});
```

### Multimodal Support

```typescript
// Initialize multimodal
await context.initMultimodal({
  path: '/path/to/mmproj.gguf',
  use_gpu: true
});

// Process image
const result = await context.completion({
  messages: [{
    role: "user",
    content: [
      { type: "text", text: "What's in this image?" },
      { type: "image_url", image_url: { url: "file:///image.jpg" } }
    ]
  }]
});
```

### TTS (Text-to-Speech)

```typescript
// Initialize TTS
await context.initVocoder({
  path: '/path/to/vocoder.gguf',
  n_batch: 512
});

// Generate audio
const audioCompletion = await context.getFormattedAudioCompletion(
  null, "Hello world!"
);
const guideTokens = await context.getAudioCompletionGuideTokens("Hello world!");
const audioResult = await context.completion({
  prompt: audioCompletion.prompt,
  grammar: audioCompletion.grammar,
  guide_tokens: guideTokens,
  n_predict: 1000
});
if (audioResult.audio_tokens) {
  const audioData = await context.decodeAudioTokens(audioResult.audio_tokens);
}
```

### LoRA Adapters

```typescript
// Apply adapters
await context.applyLoraAdapters([
  { path: '/path/to/adapter.gguf', scaled: 1.0 }
]);

// Check loaded adapters
const adapters = await context.getLoadedLoraAdapters();

// Remove adapters
await context.removeLoraAdapters();
```

### Session Management

```typescript
// Save session
const tokensSaved = await context.saveSession('/path/to/session.gguf', {
  tokenSize: 1000
});

// Load session
const session = await context.loadSession('/path/to/session.gguf');
```

### Structured Output

```typescript
const result = await context.completion({
  prompt: "Generate a person object:",
  n_predict: 100,
  response_format: {
    type: 'json_schema',
    json_schema: {
      strict: true,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        },
        required: ['name', 'age']
      }
    }
  }
});
```

## Configuration Parameters

### ContextParams

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | string | - | Model file path |
| `n_ctx` | number | 512 | Context size |
| `n_threads` | number | 4 | CPU threads |
| `n_gpu_layers` | number | 0 | GPU layers (iOS) |
| `use_mlock` | boolean | false | Lock memory |
| `use_mmap` | boolean | true | Memory mapping |
| `embedding` | boolean | false | Embedding mode |

### CompletionParams

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `prompt` | string | - | Text prompt |
| `messages` | Array | - | Chat messages |
| `n_predict` | number | -1 | Max tokens |
| `temperature` | number | 0.8 | Sampling temp |
| `top_p` | number | 0.95 | Top-p sampling |
| `top_k` | number | 40 | Top-k sampling |
| `stop` | Array | [] | Stop sequences |
| `seed` | number | -1 | Random seed |

## Platform Support

| Feature | iOS | Android | Web |
|---------|-----|---------|-----|
| Text Generation | ✅ | ✅ | ❌ |
| Chat | ✅ | ✅ | ❌ |
| Streaming | ✅ | ✅ | ❌ |
| Multimodal | ✅ | ✅ | ❌ |
| TTS | ✅ | ✅ | ❌ |
| LoRA | ✅ | ✅ | ❌ |
| Embeddings | ✅ | ✅ | ❌ |
| Sessions | ✅ | ✅ | ❌ |

## Error Handling

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
  
  await context.release();
} catch (error) {
  console.error('Error:', error.message);
}
```

## Performance Tips

1. **Use quantized models** (Q4_K_M, Q5_K_M)
2. **Adjust context size** based on needs
3. **Enable GPU** on iOS (`n_gpu_layers`)
4. **Use streaming** for long generations
5. **Release contexts** when done
6. **Monitor memory** with `use_mlock: false`

## Debugging

```typescript
import { toggleNativeLog, addNativeLogListener } from 'llama-cpp-capacitor';

// Enable logging
await toggleNativeLog(true);

// Add log listener
const logListener = addNativeLogListener((level, text) => {
  console.log(`[${level}] ${text}`);
});

// Remove listener when done
logListener.remove();
```

## Common Patterns

### Basic Text Generation
```typescript
const context = await initLlama({
  model: '/path/to/model.gguf',
  n_ctx: 2048,
  n_threads: 4
});

const result = await context.completion({
  prompt: "Write a story:",
  n_predict: 150,
  temperature: 0.8
});

console.log(result.text);
await context.release();
```

### Chat Conversation
```typescript
const result = await context.completion({
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "What is AI?" }
  ],
  n_predict: 100,
  temperature: 0.7
});
```

### Streaming Generation
```typescript
let fullText = '';
await context.completion({
  prompt: "Explain quantum computing:",
  n_predict: 200
}, (tokenData) => {
  fullText += tokenData.token;
  process.stdout.write(tokenData.token);
});
```

### Model Information
```typescript
console.log('Model:', context.model.desc);
console.log('Size:', context.model.size);
console.log('GPU:', context.gpu);
console.log('Chat templates:', context.model.chatTemplates);
```

This quick reference covers the most common use cases. For detailed API documentation, see `API_DOCUMENTATION.md`.
