// Native parameter types that match llama.rn exactly
export interface NativeEmbeddingParams {
  embd_normalize?: number;
}

export interface NativeContextParams {
  model: string;
  /**
   * Chat template to override the default one from the model.
   */
  chat_template?: string;

  is_model_asset?: boolean;
  use_progress_callback?: boolean;

  n_ctx?: number;
  n_batch?: number;
  n_ubatch?: number;

  n_threads?: number;

  /**
   * Path to draft model for speculative decoding (mobile optimization)
   */
  draft_model?: string;
  /**
   * Number of tokens to predict speculatively (default: 3 for mobile)
   */
  speculative_samples?: number;
  /**
   * Enable mobile-optimized speculative decoding
   */
  mobile_speculative?: boolean;

  /**
   * Number of layers to store in VRAM (Currently only for iOS)
   */
  n_gpu_layers?: number;
  /**
   * Skip GPU devices (iOS only)
   */
  no_gpu_devices?: boolean;

  /**
   * Enable flash attention, only recommended in GPU device (Experimental in llama.cpp)
   */
  flash_attn?: boolean;

  /**
   * KV cache data type for the K (Experimental in llama.cpp)
   */
  cache_type_k?: string;
  /**
   * KV cache data type for the V (Experimental in llama.cpp)
   */
  cache_type_v?: string;

  use_mlock?: boolean;
  use_mmap?: boolean;
  vocab_only?: boolean;

  /**
   * Single LoRA adapter path
   */
  lora?: string;
  /**
   * Single LoRA adapter scale
   */
  lora_scaled?: number;
  /**
   * LoRA adapter list
   */
  lora_list?: Array<{ path: string; scaled?: number }>;

  rope_freq_base?: number;
  rope_freq_scale?: number;

  pooling_type?: number;

  /**
   * Enable context shifting to handle prompts larger than context size
   */
  ctx_shift?: boolean;

  /**
   * Use a unified buffer across the input sequences when computing the attention.
   * Try to disable when n_seq_max > 1 for improved performance when the sequences do not share a large prefix.
   */
  kv_unified?: boolean;

  /**
   * Use full-size SWA cache (https://github.com/ggml-org/llama.cpp/pull/13194#issuecomment-2868343055)
   */
  swa_full?: boolean;

  /**
   * Number of layers to keep MoE weights on CPU
   */
  n_cpu_moe?: number;

  // Embedding params
  embedding?: boolean;
  embd_normalize?: number;
}

export interface NativeCompletionParams {
  prompt: string;
  n_threads?: number;
  /**
   * Enable Jinja. Default: true if supported by the model
   */
  jinja?: boolean;
  /**
   * JSON schema for convert to grammar for structured JSON output.
   * It will be override by grammar if both are set.
   */
  json_schema?: string;
  /**
   * Set grammar for grammar-based sampling (GBNF format). Default: no grammar
   * This will override json_schema if both are provided.
   */
  grammar?: string;
  /**
   * Lazy grammar sampling, trigger by grammar_triggers. Default: false
   */
  grammar_lazy?: boolean;
  /**
   * Enable thinking if jinja is enabled. Default: true
   */
  enable_thinking?: boolean;
  /**
   * Force thinking to be open. Default: false
   */
  thinking_forced_open?: boolean;
  /**
   * Lazy grammar triggers. Default: []
   */
  grammar_triggers?: Array<{
    type: number;
    value: string;
    token: number;
  }>;
  preserved_tokens?: Array<string>;
  chat_format?: number;
  reasoning_format?: string;
  /**
   * Path to an image file to process before generating text.
   * When provided, the image will be processed and added to the context.
   * Requires multimodal support to be enabled via initMultimodal.
   */
  media_paths?: Array<string>;
  /**
   * Specify a JSON array of stopping strings.
   * These words will not be included in the completion, so make sure to add them to the prompt for the next iteration. Default: `[]`
   */
  stop?: Array<string>;
  /**
   * Set the maximum number of tokens to predict when generating text.
   * **Note:** May exceed the set limit slightly if the last token is a partial multibyte character.
   * When 0,no tokens will be generated but the prompt is evaluated into the cache. Default: `-1`, where `-1` is infinity.
   */
  n_predict?: number;
  /**
   * If greater than 0, the response also contains the probabilities of top N tokens for each generated token given the sampling settings.
   * Note that for temperature < 0 the tokens are sampled greedily but token probabilities are still being calculated via a simple softmax of the logits without considering any other sampler settings.
   * Default: `0`
   */
  n_probs?: number;
  /**
   * Limit the next token selection to the K most probable tokens.  Default: `40`
   */
  top_k?: number;
  /**
   * Limit the next token selection to a subset of tokens with a cumulative probability above a threshold P. Default: `0.95`
   */
  top_p?: number;
  /**
   * The minimum probability for a token to be considered, relative to the probability of the most likely token. Default: `0.05`
   */
  min_p?: number;
  /**
   * Set the chance for token removal via XTC sampler. Default: `0.0`, which is disabled.
   */
  xtc_probability?: number;
  /**
   * Set a minimum probability threshold for tokens to be removed via XTC sampler. Default: `0.1` (> `0.5` disables XTC)
   */
  xtc_threshold?: number;
  /**
   * Enable locally typical sampling with parameter p. Default: `1.0`, which is disabled.
   */
  typical_p?: number;
  /**
   * Adjust the randomness of the generated text. Default: `0.8`
   */
  temperature?: number;
  /**
   * Last n tokens to consider for penalizing repetition. Default: `64`, where `0` is disabled and `-1` is ctx-size.
   */
  penalty_last_n?: number;
  /**
   * Control the repetition of token sequences in the generated text. Default: `1.0`
   */
  penalty_repeat?: number;
  /**
   * Repeat alpha frequency penalty. Default: `0.0`, which is disabled.
   */
  penalty_freq?: number;
  /**
   * Repeat alpha presence penalty. Default: `0.0`, which is disabled.
   */
  penalty_present?: number;
  /**
   * Enable Mirostat sampling, controlling perplexity during text generation. Default: `0`, where `0` is disabled, `1` is Mirostat, and `2` is Mirostat 2.0.
   */
  mirostat?: number;
  /**
   * Set the Mirostat target entropy, parameter tau. Default: `5.0`
   */
  mirostat_tau?: number;
  /**
   * Set the Mirostat learning rate, parameter eta. Default: `0.1`
   */
  mirostat_eta?: number;
  /**
   * Set the DRY (Don't Repeat Yourself) repetition penalty multiplier. Default: `0.0`, which is disabled.
   */
  dry_multiplier?: number;
  /**
   * Set the DRY repetition penalty base value. Default: `1.75`
   */
  dry_base?: number;
  /**
   * Tokens that extend repetition beyond this receive exponentially increasing penalty: multiplier * base ^ (length of repeating sequence before token - allowed length). Default: `2`
   */
  dry_allowed_length?: number;
  /**
   * How many tokens to scan for repetitions. Default: `-1`, where `0` is disabled and `-1` is context size.
   */
  dry_penalty_last_n?: number;
  /**
   * Specify an array of sequence breakers for DRY sampling. Only a JSON array of strings is accepted. Default: `['\n', ':', '"', '*']`
   */
  dry_sequence_breakers?: Array<string>;
  /**
   * Top n sigma sampling as described in academic paper "Top-nσ: Not All Logits Are You Need" https://arxiv.org/pdf/2411.07641. Default: `-1.0` (Disabled)
   */
  top_n_sigma?: number;

  /**
   * Ignore end of stream token and continue generating. Default: `false`
   */
  ignore_eos?: boolean;
  /**
   * Modify the likelihood of a token appearing in the generated text completion.
   * For example, use `"logit_bias": [[15043,1.0]]` to increase the likelihood of the token 'Hello', or `"logit_bias": [[15043,-1.0]]` to decrease its likelihood.
   * Setting the value to false, `"logit_bias": [[15043,false]]` ensures that the token `Hello` is never produced. The tokens can also be represented as strings,
   * e.g.`[["Hello, World!",-0.5]]` will reduce the likelihood of all the individual tokens that represent the string `Hello, World!`, just like the `presence_penalty` does.
   * Default: `[]`
   */
  logit_bias?: Array<Array<number>>;
  /**
   * Set the random number generator (RNG) seed. Default: `-1`, which is a random seed.
   */
  seed?: number;

  /**
   * Guide tokens for the completion.
   * Help prevent hallucinations by forcing the TTS to use the correct words.
   * Default: `[]`
   */
  guide_tokens?: Array<number>;

  emit_partial_completion: boolean;
}

export interface NativeCompletionTokenProbItem {
  tok_str: string;
  prob: number;
}

export interface NativeCompletionTokenProb {
  content: string;
  probs: Array<NativeCompletionTokenProbItem>;
}

export interface NativeCompletionResultTimings {
  prompt_n: number;
  prompt_ms: number;
  prompt_per_token_ms: number;
  prompt_per_second: number;
  predicted_n: number;
  predicted_ms: number;
  predicted_per_token_ms: number;
  predicted_per_second: number;
}

export interface NativeCompletionResult {
  /**
   * Original text (Ignored reasoning_content / tool_calls)
   */
  text: string;
  /**
   * Reasoning content (parsed for reasoning model)
   */
  reasoning_content: string;
  /**
   * Tool calls (parsed from response)
   */
  tool_calls: Array<{
    type: 'function';
    function: {
      name: string;
      arguments: string; // JSON string of arguments
    };
    id?: string;
  }>;
  /**
   * Content text (Filtered text by reasoning_content / tool_calls)
   */
  content: string;

  chat_format: number;

  tokens_predicted: number;
  tokens_evaluated: number;
  truncated: boolean;
  stopped_eos: boolean;
  stopped_word: string;
  stopped_limit: number;
  stopping_word: string;
  context_full: boolean;
  interrupted: boolean;
  tokens_cached: number;
  timings: NativeCompletionResultTimings;

  completion_probabilities?: Array<NativeCompletionTokenProb>;
  audio_tokens?: Array<number>;
}

export interface NativeTokenizeResult {
  tokens: Array<number>;
  /**
   * Whether the tokenization contains images
   */
  has_images: boolean;
  /**
   * Bitmap hashes of the images
   */
  bitmap_hashes: Array<number>;
  /**
   * Chunk positions of the text and images
   */
  chunk_pos: Array<number>;
  /**
   * Chunk positions of the images
   */
  chunk_pos_images: Array<number>;
}

export interface NativeEmbeddingResult {
  embedding: Array<number>;
}

export interface NativeLlamaContext {
  contextId: number;
  model: {
    desc: string;
    size: number;
    nEmbd: number;
    nParams: number;
    chatTemplates: {
      llamaChat: boolean; // Chat template in llama-chat.cpp
      minja: {
        // Chat template supported by minja.hpp
        default: boolean;
        defaultCaps: {
          tools: boolean;
          toolCalls: boolean;
          toolResponses: boolean;
          systemRole: boolean;
          parallelToolCalls: boolean;
          toolCallId: boolean;
        };
        toolUse: boolean;
        toolUseCaps: {
          tools: boolean;
          toolCalls: boolean;
          toolResponses: boolean;
          systemRole: boolean;
          parallelToolCalls: boolean;
          toolCallId: boolean;
        };
      };
    };
    metadata: Object;
    isChatTemplateSupported: boolean; // Deprecated
  };
  /**
   * Loaded library name for Android
   */
  androidLib?: string;
  gpu: boolean;
  reasonNoGPU: string;
}

export interface NativeSessionLoadResult {
  tokens_loaded: number;
  prompt: string;
}

export interface NativeLlamaMessagePart {
  type: 'text';
  text: string;
}

export interface NativeLlamaChatMessage {
  role: string;
  content: string | Array<NativeLlamaMessagePart>;
}

export interface FormattedChatResult {
  type: 'jinja' | 'llama-chat';
  prompt: string;
  has_media: boolean;
  media_paths?: Array<string>;
}

export interface JinjaFormattedChatResult extends FormattedChatResult {
  chat_format?: number;
  grammar?: string;
  grammar_lazy?: boolean;
  grammar_triggers?: Array<{
    type: number;
    value: string;
    token: number;
  }>;
  thinking_forced_open?: boolean;
  preserved_tokens?: Array<string>;
  additional_stops?: Array<string>;
}

export interface NativeImageProcessingResult {
  success: boolean;
  prompt: string;
  error?: string;
}

export interface NativeRerankParams {
  normalize?: number;
}

export interface NativeRerankResult {
  score: number;
  index: number;
}

// High-level types for the plugin interface
export interface LlamaCppMessagePart {
  type: string;
  text?: string;
  image_url?: {
    url?: string;
  };
  input_audio?: {
    format: string;
    data?: string;
    url?: string;
  };
}

export interface LlamaCppOAICompatibleMessage {
  role: string;
  content?: string | LlamaCppMessagePart[];
}

export interface ToolCall {
  type: 'function';
  id?: string;
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface TokenData {
  token: string;
  completion_probabilities?: Array<NativeCompletionTokenProb>;
  // Parsed content from accumulated text
  content?: string;
  reasoning_content?: string;
  tool_calls?: Array<ToolCall>;
  accumulated_text?: string;
}

export interface ContextParams extends Omit<
  NativeContextParams,
  'cache_type_k' | 'cache_type_v' | 'pooling_type'
> {
  cache_type_k?:
    | 'f16'
    | 'f32'
    | 'q8_0'
    | 'q4_0'
    | 'q4_1'
    | 'iq4_nl'
    | 'q5_0'
    | 'q5_1';
  cache_type_v?:
    | 'f16'
    | 'f32'
    | 'q8_0'
    | 'q4_0'
    | 'q4_1'
    | 'iq4_nl'
    | 'q5_0'
    | 'q5_1';
  pooling_type?: 'none' | 'mean' | 'cls' | 'last' | 'rank';
}

export interface EmbeddingParams extends NativeEmbeddingParams {}

export interface RerankParams {
  normalize?: number;
}

export interface RerankResult {
  score: number;
  index: number;
  document?: string;
}

export interface CompletionResponseFormat {
  type: 'text' | 'json_object' | 'json_schema';
  json_schema?: {
    strict?: boolean;
    schema: object;
  };
  schema?: object; // for json_object type
}

export interface CompletionBaseParams {
  prompt?: string;
  messages?: LlamaCppOAICompatibleMessage[];
  chatTemplate?: string; // deprecated
  chat_template?: string;
  jinja?: boolean;
  tools?: object;
  parallel_tool_calls?: object;
  tool_choice?: string;
  response_format?: CompletionResponseFormat;
  media_paths?: string[];
  add_generation_prompt?: boolean;
  /*
   * Timestamp in seconds since epoch to apply to chat template's strftime_now
   */
  now?: string | number;
  chat_template_kwargs?: Record<string, string>;
  /**
   * Prefill text to be used for chat parsing (Generation Prompt + Content)
   * Used for if last assistant message is for prefill purpose
   */
  prefill_text?: string;
}

export interface CompletionParams extends Omit<
  NativeCompletionParams,
  'emit_partial_completion' | 'prompt'
> {
  prompt?: string;
  messages?: LlamaCppOAICompatibleMessage[];
  chatTemplate?: string; // deprecated
  chat_template?: string;
  jinja?: boolean;
  /**
   * GBNF grammar for structured output. Takes precedence over json_schema.
   */
  grammar?: string;
  tools?: object;
  parallel_tool_calls?: object;
  tool_choice?: string;
  response_format?: CompletionResponseFormat;
  media_paths?: string[];
  add_generation_prompt?: boolean;
  /*
   * Timestamp in seconds since epoch to apply to chat template's strftime_now
   */
  now?: string | number;
  chat_template_kwargs?: Record<string, string>;
  /**
   * Prefill text to be used for chat parsing (Generation Prompt + Content)
   * Used for if last assistant message is for prefill purpose
   */
  prefill_text?: string;
}

export interface BenchResult {
  modelDesc: string;
  modelSize: number;
  modelNParams: number;
  ppAvg: number;
  ppStd: number;
  tgAvg: number;
  tgStd: number;
}

// Main plugin interface
export interface LlamaCppPlugin {
  // Core initialization and management
  toggleNativeLog(options: { enabled: boolean }): Promise<void>;
  setContextLimit(options: { limit: number }): Promise<void>;
  modelInfo(options: { path: string; skip?: string[] }): Promise<Object>;
  initContext(options: { contextId: number; params: NativeContextParams }): Promise<NativeLlamaContext>;
  releaseContext(options: { contextId: number }): Promise<void>;
  releaseAllContexts(): Promise<void>;

  // Chat and completion
  getFormattedChat(options: {
    contextId: number;
    messages: string;
    chatTemplate?: string;
    params?: {
      jinja?: boolean;
      json_schema?: string;
      tools?: string;
      parallel_tool_calls?: string;
      tool_choice?: string;
      enable_thinking?: boolean;
      add_generation_prompt?: boolean;
      now?: string;
      chat_template_kwargs?: string;
    };
  }): Promise<JinjaFormattedChatResult | string>;

  completion(options: {
    contextId: number;
    params: NativeCompletionParams;
  }): Promise<NativeCompletionResult>;

  // Chat-first methods (like llama-cli -sys)
  chat(options: {
    contextId: number;
    messages: LlamaCppOAICompatibleMessage[];
    system?: string; // Simple system prompt like llama-cli -sys
    chatTemplate?: string;
    params?: Omit<NativeCompletionParams, 'prompt' | 'messages'>;
  }): Promise<NativeCompletionResult>;

  // Simple chat with system prompt (like llama-cli -sys "You are a helpful assistant")
  chatWithSystem(options: {
    contextId: number;
    system: string;
    message: string;
    params?: Omit<NativeCompletionParams, 'prompt' | 'messages'>;
  }): Promise<NativeCompletionResult>;

  // Simple text generation (like llama-cli -p "prompt")
  generateText(options: {
    contextId: number;
    prompt: string;
    params?: Omit<NativeCompletionParams, 'prompt' | 'messages'>;
  }): Promise<NativeCompletionResult>;

  stopCompletion(options: { contextId: number }): Promise<void>;

  // Session management
  loadSession(options: {
    contextId: number;
    filepath: string;
  }): Promise<NativeSessionLoadResult>;

  saveSession(options: {
    contextId: number;
    filepath: string;
    size: number;
  }): Promise<number>;

  // Tokenization
  tokenize(options: {
    contextId: number;
    text: string;
    imagePaths?: Array<string>;
  }): Promise<NativeTokenizeResult>;

  detokenize(options: {
    contextId: number;
    tokens: number[];
  }): Promise<string>;

  // Embeddings and reranking
  embedding(options: {
    contextId: number;
    text: string;
    params: NativeEmbeddingParams;
  }): Promise<NativeEmbeddingResult>;

  rerank(options: {
    contextId: number;
    query: string;
    documents: Array<string>;
    params?: NativeRerankParams;
  }): Promise<Array<NativeRerankResult>>;

  // Benchmarking
  bench(options: {
    contextId: number;
    pp: number;
    tg: number;
    pl: number;
    nr: number;
  }): Promise<string>;

  // LoRA adapters
  applyLoraAdapters(options: {
    contextId: number;
    loraAdapters: Array<{ path: string; scaled?: number }>;
  }): Promise<void>;

  removeLoraAdapters(options: { contextId: number }): Promise<void>;

  getLoadedLoraAdapters(options: {
    contextId: number;
  }): Promise<Array<{ path: string; scaled?: number }>>;

  // Multimodal methods
  initMultimodal(options: {
    contextId: number;
    params: {
      path: string;
      use_gpu: boolean;
    };
  }): Promise<boolean>;

  isMultimodalEnabled(options: {
    contextId: number;
  }): Promise<boolean>;

  getMultimodalSupport(options: {
    contextId: number;
  }): Promise<{
    vision: boolean;
    audio: boolean;
  }>;

  releaseMultimodal(options: {
    contextId: number;
  }): Promise<void>;

  // TTS methods
  initVocoder(options: {
    contextId: number;
    params: {
      path: string;
      n_batch?: number;
    };
  }): Promise<boolean>;

  isVocoderEnabled(options: { contextId: number }): Promise<boolean>;

  getFormattedAudioCompletion(options: {
    contextId: number;
    speakerJsonStr: string;
    textToSpeak: string;
  }): Promise<{
    prompt: string;
    grammar?: string;
  }>;

  getAudioCompletionGuideTokens(options: {
    contextId: number;
    textToSpeak: string;
  }): Promise<Array<number>>;

  decodeAudioTokens(options: {
    contextId: number;
    tokens: number[];
  }): Promise<Array<number>>;

  releaseVocoder(options: { contextId: number }): Promise<void>;

  // Model download and management
  downloadModel(options: {
    url: string;
    filename: string;
  }): Promise<string>;

  getDownloadProgress(options: {
    url: string;
  }): Promise<{
    progress: number;
    completed: boolean;
    failed: boolean;
    errorMessage?: string;
    localPath?: string;
    downloadedBytes: number;
    totalBytes: number;
  }>;

  cancelDownload(options: {
    url: string;
  }): Promise<boolean>;

  getAvailableModels(): Promise<Array<{
    name: string;
    path: string;
    size: number;
  }>>;

  // Grammar utilities
  convertJsonSchemaToGrammar(options: {
    schema: string;
  }): Promise<string>;

  // Events
  addListener(eventName: string, listenerFunc: (data: any) => void): Promise<void>;
  removeAllListeners(eventName: string): Promise<void>;
}
