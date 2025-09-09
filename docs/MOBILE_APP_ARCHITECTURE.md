# 🏗️ Mobile App Architecture Design
## Using llama-cpp-capacitor Plugin

### **Executive Summary**

This document provides a comprehensive mobile app architecture for integrating the llama-cpp-capacitor plugin, covering initialization sequences, model management, prompt processing, and response handling with mobile-specific optimizations.

---

## 📋 **Table of Contents**

1. [High-Level Architecture](#high-level-architecture)
2. [Initialization Sequence](#initialization-sequence)
3. [Model Management Strategy](#model-management-strategy)
4. [Prompt Processing Pipeline](#prompt-processing-pipeline)
5. [Response Handling Pattern](#response-handling-pattern)
6. [Mobile-Specific Considerations](#mobile-specific-considerations)
7. [State Management](#state-management)
8. [Error Handling & Recovery](#error-handling--recovery)
9. [Performance Optimization](#performance-optimization)
10. [Security Considerations](#security-considerations)
11. [Testing Strategy](#testing-strategy)

---

## 🎯 **High-Level Architecture**

### **Component Overview**

```
┌─────────────────────────────────────────────────────┐
│                   Mobile App Layer                  │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │     UI      │  │  Business   │  │   State     │  │
│  │ Components  │  │   Logic     │  │ Management  │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────┤
│                Service Layer                        │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Model     │  │   Prompt    │  │  Response   │  │
│  │  Manager    │  │  Processor  │  │  Handler    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────┤
│            llama-cpp-capacitor Plugin              │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Native    │  │   Model     │  │ Speculative │  │
│  │   Bridge    │  │   Engine    │  │  Decoding   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
├─────────────────────────────────────────────────────┤
│                Platform Layer                       │
├─────────────────────────────────────────────────────┤
│     ┌─────────────┐              ┌─────────────┐     │
│     │   iOS       │              │   Android   │     │
│     │   Native    │              │   Native    │     │
│     └─────────────┘              └─────────────┘     │
└─────────────────────────────────────────────────────┘
```

### **Key Architectural Principles**

1. **Separation of Concerns**: Clear layer separation for maintainability
2. **Mobile-First Design**: Optimized for mobile constraints and patterns
3. **Async-First**: Non-blocking operations throughout
4. **Resource-Aware**: Memory and battery optimization
5. **Fault-Tolerant**: Graceful degradation and recovery
6. **Scalable**: Support for multiple models and concurrent operations

---

## 🚀 **Initialization Sequence**

### **Phase 1: App Startup**

```typescript
/**
 * Application Initialization Sequence
 * Critical path for app startup performance
 */

class LlamaAppInitializer {
  private static instance: LlamaAppInitializer;
  private initializationPromise: Promise<void> | null = null;

  static getInstance(): LlamaAppInitializer {
    if (!LlamaAppInitializer.instance) {
      LlamaAppInitializer.instance = new LlamaAppInitializer();
    }
    return LlamaAppInitializer.instance;
  }

  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.performInitialization();
    return this.initializationPromise;
  }

  private async performInitialization(): Promise<void> {
    console.log('🚀 Starting LlamaApp initialization...');
    
    try {
      // Step 1: Initialize plugin and check capabilities
      await this.initializePlugin();
      
      // Step 2: Setup model management
      await this.initializeModelManager();
      
      // Step 3: Initialize state management
      await this.initializeStateManager();
      
      // Step 4: Setup background services
      await this.initializeBackgroundServices();
      
      console.log('✅ LlamaApp initialization completed');
    } catch (error) {
      console.error('❌ LlamaApp initialization failed:', error);
      throw error;
    }
  }

  private async initializePlugin(): Promise<void> {
    // Check plugin availability
    const pluginAvailable = await LlamaCpp.isPluginAvailable();
    if (!pluginAvailable) {
      throw new Error('llama-cpp-capacitor plugin not available');
    }

    // Enable logging for development
    if (__DEV__) {
      await LlamaCpp.toggleNativeLog(true);
    }

    // Set reasonable context limits for mobile
    await LlamaCpp.setContextLimit(3); // Max 3 concurrent contexts
  }
}
```

### **Phase 2: Model Bootstrap**

```typescript
/**
 * Model Management and Loading Strategy
 */

class ModelManager {
  private static instance: ModelManager;
  private models: Map<string, LlamaContext> = new Map();
  private loadingPromises: Map<string, Promise<LlamaContext>> = new Map();
  
  async loadPrimaryModel(config: ModelConfig): Promise<LlamaContext> {
    console.log('📦 Loading primary model...');
    
    const modelId = 'primary';
    
    // Check if already loading
    if (this.loadingPromises.has(modelId)) {
      return this.loadingPromises.get(modelId)!;
    }

    // Check if already loaded
    if (this.models.has(modelId)) {
      return this.models.get(modelId)!;
    }

    // Start loading
    const loadingPromise = this.loadModel(config);
    this.loadingPromises.set(modelId, loadingPromise);

    try {
      const context = await loadingPromise;
      this.models.set(modelId, context);
      this.loadingPromises.delete(modelId);
      
      console.log('✅ Primary model loaded successfully');
      return context;
    } catch (error) {
      this.loadingPromises.delete(modelId);
      console.error('❌ Primary model loading failed:', error);
      throw error;
    }
  }

  private async loadModel(config: ModelConfig): Promise<LlamaContext> {
    const startTime = Date.now();
    
    // Mobile-optimized configuration
    const context = await initLlama({
      model: config.modelPath,
      draft_model: config.draftModelPath, // For speculative decoding
      
      // Mobile-optimized parameters
      n_ctx: config.contextSize || 1024,        // Conservative context
      n_threads: config.threads || 3,           // Don't overwhelm CPU
      n_batch: config.batchSize || 64,          // Smaller batches
      n_gpu_layers: config.gpuLayers || 24,     // Utilize mobile GPU
      
      // Speculative decoding for performance
      speculative_samples: 3,                   // Mobile-optimized
      mobile_speculative: true,                 // Mobile optimizations
      
      // Memory optimization
      use_mmap: true,                           // Memory mapping
      use_mlock: false,                         // Don't lock on mobile
      
    }, (progress: number) => {
      // Progress callback for UI updates
      EventBus.emit('model:loading:progress', {
        modelId: config.id,
        progress,
        stage: progress < 50 ? 'loading' : 'initializing'
      });
    });

    const loadTime = Date.now() - startTime;
    console.log(`⏱️ Model loaded in ${loadTime}ms`);
    
    // Store model metadata
    context.metadata = {
      id: config.id,
      loadTime,
      config
    };

    return context;
  }
}
```

---

## 🧠 **Model Management Strategy**

### **Multi-Model Architecture**

```typescript
/**
 * Advanced Model Management with Role-Based Models
 */

interface ModelConfig {
  id: string;
  role: 'primary' | 'draft' | 'specialized';
  modelPath: string;
  draftModelPath?: string;
  contextSize: number;
  priority: number;
  capabilities: string[];
}

class AdvancedModelManager extends ModelManager {
  private modelConfigs: ModelConfig[] = [
    {
      id: 'primary-chat',
      role: 'primary',
      modelPath: '/models/llama-2-7b-chat.q4_0.gguf',
      draftModelPath: '/models/tinyllama-1.1b-chat.q4_0.gguf',
      contextSize: 2048,
      priority: 1,
      capabilities: ['chat', 'general', 'reasoning']
    },
    {
      id: 'code-assistant',
      role: 'specialized',
      modelPath: '/models/codellama-7b-instruct.q4_0.gguf',
      contextSize: 4096,
      priority: 2,
      capabilities: ['code', 'programming', 'debugging']
    }
  ];

  async getModelForTask(taskType: string): Promise<LlamaContext> {
    // Intelligent model selection based on task
    const suitableModel = this.modelConfigs
      .filter(config => config.capabilities.includes(taskType))
      .sort((a, b) => a.priority - b.priority)[0];

    if (!suitableModel) {
      // Fallback to primary model
      return this.getModel('primary-chat');
    }

    return this.getModel(suitableModel.id);
  }

  async preloadModels(): Promise<void> {
    // Background model preloading for better UX
    const highPriorityModels = this.modelConfigs
      .filter(config => config.priority <= 2)
      .sort((a, b) => a.priority - b.priority);

    for (const config of highPriorityModels) {
      try {
        await this.loadModel(config);
        console.log(`✅ Preloaded model: ${config.id}`);
      } catch (error) {
        console.warn(`⚠️ Failed to preload model ${config.id}:`, error);
      }
    }
  }
}
```

### **Model Download Manager**

```typescript
/**
 * Intelligent Model Download and Management
 */

class ModelDownloadManager {
  private downloadQueue: ModelDownloadTask[] = [];
  private activeDownloads: Map<string, Promise<string>> = new Map();

  async ensureModelAvailable(modelConfig: ModelConfig): Promise<string> {
    const localPath = await this.getLocalModelPath(modelConfig.id);
    
    if (await this.isModelValid(localPath)) {
      return localPath;
    }

    // Download if not available
    return this.downloadModel(modelConfig);
  }

  private async downloadModel(config: ModelConfig): Promise<string> {
    const downloadId = config.id;
    
    // Check if already downloading
    if (this.activeDownloads.has(downloadId)) {
      return this.activeDownloads.get(downloadId)!;
    }

    const downloadPromise = this.performDownload(config);
    this.activeDownloads.set(downloadId, downloadPromise);

    try {
      const localPath = await downloadPromise;
      this.activeDownloads.delete(downloadId);
      return localPath;
    } catch (error) {
      this.activeDownloads.delete(downloadId);
      throw error;
    }
  }

  private async performDownload(config: ModelConfig): Promise<string> {
    console.log(`📥 Downloading model: ${config.id}`);
    
    // Use plugin's download functionality
    const localPath = await downloadModel(config.downloadUrl!, config.filename);
    
    // Validate downloaded model
    if (!(await this.isModelValid(localPath))) {
      throw new Error(`Downloaded model ${config.id} is invalid`);
    }

    console.log(`✅ Model downloaded: ${config.id} -> ${localPath}`);
    return localPath;
  }

  async getDownloadProgress(modelId: string): Promise<DownloadProgress> {
    return getDownloadProgress(this.getDownloadUrl(modelId));
  }
}
```

---

## 💬 **Prompt Processing Pipeline**

### **Prompt Builder Pattern**

```typescript
/**
 * Advanced Prompt Processing with Context Management
 */

interface ConversationContext {
  messages: Message[];
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  metadata: Record<string, any>;
}

class PromptProcessor {
  private conversationHistory: Map<string, ConversationContext> = new Map();
  private templateEngine: PromptTemplateEngine;

  constructor() {
    this.templateEngine = new PromptTemplateEngine();
  }

  async processPrompt(request: PromptRequest): Promise<ProcessedPrompt> {
    console.log('🔄 Processing prompt request...');

    try {
      // Step 1: Context management
      const context = await this.getOrCreateContext(request.conversationId);
      
      // Step 2: Prompt enhancement
      const enhancedPrompt = await this.enhancePrompt(request, context);
      
      // Step 3: Template application
      const formattedPrompt = await this.applyTemplate(enhancedPrompt, context);
      
      // Step 4: Context window management
      const optimizedPrompt = await this.optimizeForContext(formattedPrompt, context);
      
      return {
        prompt: optimizedPrompt,
        context,
        metadata: {
          originalLength: request.prompt.length,
          processedLength: optimizedPrompt.length,
          contextUtilization: this.calculateContextUtilization(context)
        }
      };
    } catch (error) {
      console.error('❌ Prompt processing failed:', error);
      throw error;
    }
  }

  private async enhancePrompt(request: PromptRequest, context: ConversationContext): Promise<string> {
    let enhancedPrompt = request.prompt;

    // Add context-aware enhancements
    if (request.includeHistory && context.messages.length > 0) {
      enhancedPrompt = this.addConversationHistory(enhancedPrompt, context);
    }

    // Add system instructions
    if (request.systemInstructions) {
      enhancedPrompt = this.addSystemInstructions(enhancedPrompt, request.systemInstructions);
    }

    // Add task-specific formatting
    if (request.taskType) {
      enhancedPrompt = await this.addTaskFormatting(enhancedPrompt, request.taskType);
    }

    return enhancedPrompt;
  }

  private async optimizeForContext(prompt: string, context: ConversationContext): Promise<string> {
    const tokenCount = await this.estimateTokenCount(prompt);
    
    if (tokenCount <= context.maxTokens * 0.8) {
      return prompt; // Within limits
    }

    // Implement context window sliding
    return this.slideContextWindow(prompt, context);
  }
}
```

### **Streaming Response Handler**

```typescript
/**
 * Real-time Response Processing with UI Updates
 */

class ResponseHandler {
  private activeStreams: Map<string, ResponseStream> = new Map();
  private responseBuffer: Map<string, string> = new Map();

  async processStreamingResponse(
    requestId: string,
    context: LlamaContext,
    prompt: ProcessedPrompt,
    options: CompletionOptions
  ): Promise<void> {
    console.log(`🎯 Starting streaming response for request: ${requestId}`);

    try {
      // Initialize response tracking
      this.initializeResponseTracking(requestId);

      // Start streaming completion
      const result = await context.completion({
        prompt: prompt.prompt,
        n_predict: options.maxTokens || 200,
        temperature: options.temperature || 0.7,
        
        // Mobile-optimized parameters
        repeat_penalty: 1.1,
        top_k: 40,
        top_p: 0.9,
        
        // Streaming callback
      }, (tokenData: TokenData) => {
        this.handleStreamingToken(requestId, tokenData);
      });

      // Finalize response
      await this.finalizeResponse(requestId, result);

    } catch (error) {
      console.error(`❌ Streaming response failed for ${requestId}:`, error);
      this.handleResponseError(requestId, error);
    }
  }

  private handleStreamingToken(requestId: string, tokenData: TokenData): void {
    // Update buffer
    const currentBuffer = this.responseBuffer.get(requestId) || '';
    const newBuffer = currentBuffer + tokenData.token;
    this.responseBuffer.set(requestId, newBuffer);

    // Emit real-time updates
    EventBus.emit('response:token', {
      requestId,
      token: tokenData.token,
      fullText: newBuffer,
      progress: tokenData.progress || 0
    });

    // Update UI every few tokens for smooth experience
    if (newBuffer.length % 5 === 0) {
      this.updateUI(requestId, newBuffer);
    }
  }

  private updateUI(requestId: string, text: string): void {
    // Dispatch to UI layer
    UIUpdateManager.updateResponse(requestId, {
      text,
      isComplete: false,
      timestamp: Date.now()
    });
  }
}
```

---

## 📱 **Mobile-Specific Considerations**

### **Memory Management**

```typescript
/**
 * Mobile Memory Management Strategy
 */

class MobileMemoryManager {
  private memoryThresholds = {
    warning: 0.7,    // 70% memory usage
    critical: 0.85,  // 85% memory usage
    emergency: 0.95  // 95% memory usage
  };

  private memoryMonitorInterval: NodeJS.Timeout | null = null;

  startMemoryMonitoring(): void {
    this.memoryMonitorInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, 10000); // Check every 10 seconds
  }

  private async checkMemoryUsage(): Promise<void> {
    const memoryInfo = await this.getMemoryInfo();
    const usageRatio = memoryInfo.used / memoryInfo.total;

    if (usageRatio > this.memoryThresholds.emergency) {
      await this.handleEmergencyMemory();
    } else if (usageRatio > this.memoryThresholds.critical) {
      await this.handleCriticalMemory();
    } else if (usageRatio > this.memoryThresholds.warning) {
      await this.handleWarningMemory();
    }
  }

  private async handleEmergencyMemory(): Promise<void> {
    console.warn('🚨 Emergency memory situation - aggressive cleanup');
    
    // Release all non-primary models
    await ModelManager.getInstance().releaseNonPrimaryModels();
    
    // Clear conversation histories except active ones
    ConversationManager.getInstance().clearInactiveHistories();
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Notify user if needed
    UIUpdateManager.showMemoryWarning('emergency');
  }

  private async handleCriticalMemory(): Promise<void> {
    console.warn('⚠️ Critical memory usage - cleanup initiated');
    
    // Release inactive models
    await ModelManager.getInstance().releaseInactiveModels();
    
    // Reduce context windows
    ConversationManager.getInstance().reduceContextWindows();
  }
}
```

### **Battery Optimization**

```typescript
/**
 * Battery-Aware Processing
 */

class BatteryOptimizer {
  private batteryLevel: number = 1.0;
  private isCharging: boolean = false;
  private performanceMode: 'high' | 'balanced' | 'power-saver' = 'balanced';

  async initializeBatteryMonitoring(): Promise<void> {
    if ('getBattery' in navigator) {
      const battery = await (navigator as any).getBattery();
      
      this.batteryLevel = battery.level;
      this.isCharging = battery.charging;
      
      battery.addEventListener('levelchange', () => {
        this.batteryLevel = battery.level;
        this.adjustPerformanceMode();
      });
      
      battery.addEventListener('chargingchange', () => {
        this.isCharging = battery.charging;
        this.adjustPerformanceMode();
      });
    }
    
    this.adjustPerformanceMode();
  }

  private adjustPerformanceMode(): void {
    if (this.isCharging) {
      this.performanceMode = 'high';
    } else if (this.batteryLevel < 0.2) {
      this.performanceMode = 'power-saver';
    } else if (this.batteryLevel < 0.5) {
      this.performanceMode = 'balanced';
    } else {
      this.performanceMode = 'high';
    }

    console.log(`🔋 Performance mode: ${this.performanceMode} (battery: ${(this.batteryLevel * 100).toFixed(1)}%, charging: ${this.isCharging})`);
    
    // Adjust processing parameters
    this.applyPerformanceSettings();
  }

  private applyPerformanceSettings(): void {
    const settings = this.getPerformanceSettings();
    
    // Update model manager settings
    ModelManager.getInstance().updatePerformanceSettings(settings);
    
    // Update response handler settings
    ResponseHandler.getInstance().updatePerformanceSettings(settings);
  }

  private getPerformanceSettings(): PerformanceSettings {
    switch (this.performanceMode) {
      case 'high':
        return {
          maxConcurrentRequests: 3,
          contextWindowSize: 2048,
          speculativeSamples: 4,
          batchSize: 128,
          threadCount: 4
        };
      
      case 'balanced':
        return {
          maxConcurrentRequests: 2,
          contextWindowSize: 1024,
          speculativeSamples: 3,
          batchSize: 64,
          threadCount: 3
        };
      
      case 'power-saver':
        return {
          maxConcurrentRequests: 1,
          contextWindowSize: 512,
          speculativeSamples: 2,
          batchSize: 32,
          threadCount: 2
        };
    }
  }
}
```

### **Network-Aware Operations**

```typescript
/**
 * Network-Aware Model Management
 */

class NetworkAwareManager {
  private connectionType: 'wifi' | 'cellular' | 'none' = 'none';
  private downloadQueue: ModelDownloadTask[] = [];

  async initializeNetworkMonitoring(): Promise<void> {
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      
      this.updateConnectionInfo(connection);
      
      connection.addEventListener('change', () => {
        this.updateConnectionInfo(connection);
      });
    }
  }

  private updateConnectionInfo(connection: any): void {
    this.connectionType = connection.type === 'wifi' ? 'wifi' : 
                          connection.type === 'cellular' ? 'cellular' : 'none';
    
    console.log(`📶 Network type: ${this.connectionType}`);
    
    // Adjust download behavior
    this.processDownloadQueue();
  }

  private async processDownloadQueue(): Promise<void> {
    if (this.connectionType === 'none') {
      console.log('📶 No network - pausing downloads');
      return;
    }

    if (this.connectionType === 'cellular') {
      // Ask user permission for cellular downloads
      const permission = await this.requestCellularDownloadPermission();
      if (!permission) {
        console.log('📶 Cellular downloads not permitted');
        return;
      }
    }

    // Process queue based on network type
    await this.processQueueForNetworkType();
  }

  private async requestCellularDownloadPermission(): Promise<boolean> {
    return new Promise((resolve) => {
      UIUpdateManager.showDialog({
        title: 'Cellular Data Usage',
        message: 'Download models using cellular data? This may use significant data.',
        buttons: [
          { text: 'Cancel', action: () => resolve(false) },
          { text: 'Allow', action: () => resolve(true) }
        ]
      });
    });
  }
}
```

---

## 📊 **State Management**

### **Application State Architecture**

```typescript
/**
 * Centralized State Management for LlamaApp
 */

interface AppState {
  models: ModelState;
  conversations: ConversationState;
  ui: UIState;
  system: SystemState;
}

interface ModelState {
  loaded: Record<string, ModelInfo>;
  loading: Record<string, LoadingProgress>;
  config: ModelConfiguration;
}

interface ConversationState {
  active: Record<string, Conversation>;
  history: Record<string, ConversationHistory>;
  preferences: ConversationPreferences;
}

class StateManager {
  private state: AppState;
  private listeners: Map<string, StateListener[]> = new Map();
  private persistenceManager: StatePersistenceManager;

  constructor() {
    this.state = this.initializeDefaultState();
    this.persistenceManager = new StatePersistenceManager();
  }

  async initialize(): Promise<void> {
    // Load persisted state
    const persistedState = await this.persistenceManager.loadState();
    if (persistedState) {
      this.state = { ...this.state, ...persistedState };
    }

    // Setup auto-persistence
    this.setupAutoPersistence();
  }

  // State update methods
  updateModelState(modelId: string, update: Partial<ModelInfo>): void {
    this.state.models.loaded[modelId] = {
      ...this.state.models.loaded[modelId],
      ...update
    };
    
    this.notifyListeners('models.loaded', this.state.models.loaded);
  }

  updateConversationState(conversationId: string, update: Partial<Conversation>): void {
    this.state.conversations.active[conversationId] = {
      ...this.state.conversations.active[conversationId],
      ...update
    };
    
    this.notifyListeners('conversations.active', this.state.conversations.active);
  }

  // State subscription
  subscribe(path: string, listener: StateListener): () => void {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, []);
    }
    
    this.listeners.get(path)!.push(listener);
    
    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(path);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  private notifyListeners(path: string, value: any): void {
    const listeners = this.listeners.get(path);
    if (listeners) {
      listeners.forEach(listener => listener(value, path));
    }
  }
}
```

### **Conversation Management**

```typescript
/**
 * Advanced Conversation Management
 */

class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private stateManager: StateManager;

  async createConversation(config: ConversationConfig): Promise<string> {
    const conversationId = this.generateConversationId();
    
    const conversation: Conversation = {
      id: conversationId,
      title: config.title || 'New Conversation',
      messages: [],
      config: {
        modelId: config.modelId || 'primary-chat',
        systemPrompt: config.systemPrompt,
        maxTokens: config.maxTokens || 1024,
        temperature: config.temperature || 0.7
      },
      metadata: {
        createdAt: Date.now(),
        lastActive: Date.now(),
        totalTokens: 0
      }
    };

    this.conversations.set(conversationId, conversation);
    this.stateManager.updateConversationState(conversationId, conversation);

    console.log(`💬 Created conversation: ${conversationId}`);
    return conversationId;
  }

  async addMessage(conversationId: string, message: Message): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    conversation.messages.push(message);
    conversation.metadata.lastActive = Date.now();
    
    // Update token count
    const tokenCount = await this.estimateTokenCount(message.content);
    conversation.metadata.totalTokens += tokenCount;

    this.stateManager.updateConversationState(conversationId, conversation);
  }

  async getConversationContext(conversationId: string): Promise<ConversationContext> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    return {
      messages: conversation.messages,
      systemPrompt: conversation.config.systemPrompt,
      maxTokens: conversation.config.maxTokens,
      temperature: conversation.config.temperature,
      metadata: conversation.metadata
    };
  }

  async optimizeConversationHistory(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;

    // Implement sliding window for long conversations
    const maxMessages = 20; // Keep last 20 messages
    if (conversation.messages.length > maxMessages) {
      const messagesToKeep = conversation.messages.slice(-maxMessages);
      conversation.messages = messagesToKeep;
      
      console.log(`🗜️ Optimized conversation ${conversationId}: kept ${messagesToKeep.length} messages`);
    }
  }
}
```

---

## 🔧 **Error Handling & Recovery**

### **Comprehensive Error Management**

```typescript
/**
 * Multi-Layer Error Handling Strategy
 */

enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

interface ErrorContext {
  operation: string;
  modelId?: string;
  conversationId?: string;
  requestId?: string;
  timestamp: number;
  additionalData?: Record<string, any>;
}

class ErrorManager {
  private errorHistory: ErrorRecord[] = [];
  private recoveryStrategies: Map<string, RecoveryStrategy> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor() {
    this.initializeRecoveryStrategies();
    this.initializeCircuitBreakers();
  }

  async handleError(error: Error, context: ErrorContext): Promise<ErrorHandlingResult> {
    console.error(`❌ Error in ${context.operation}:`, error);

    // Record error
    const errorRecord = this.recordError(error, context);
    
    // Determine severity
    const severity = this.determineSeverity(error, context);
    
    // Apply recovery strategy
    const recoveryResult = await this.applyRecoveryStrategy(error, context, severity);
    
    // Update circuit breakers
    this.updateCircuitBreakers(context, recoveryResult.success);
    
    // Notify monitoring systems
    this.notifyMonitoring(errorRecord, recoveryResult);

    return recoveryResult;
  }

  private initializeRecoveryStrategies(): void {
    // Model loading errors
    this.recoveryStrategies.set('model:loading', {
      maxRetries: 3,
      backoffMultiplier: 2,
      fallbackAction: async (context) => {
        // Try loading a smaller model
        return this.loadFallbackModel(context.modelId);
      }
    });

    // Memory errors
    this.recoveryStrategies.set('memory:exhausted', {
      maxRetries: 1,
      fallbackAction: async (context) => {
        // Aggressive cleanup and retry
        await MobileMemoryManager.getInstance().handleEmergencyMemory();
        return { success: true, action: 'memory_cleaned' };
      }
    });

    // Network errors
    this.recoveryStrategies.set('network:failure', {
      maxRetries: 5,
      backoffMultiplier: 1.5,
      fallbackAction: async (context) => {
        // Switch to offline mode
        return this.switchToOfflineMode(context);
      }
    });

    // Inference errors
    this.recoveryStrategies.set('inference:failure', {
      maxRetries: 2,
      fallbackAction: async (context) => {
        // Simplify generation parameters
        return this.simplifyGenerationParameters(context);
      }
    });
  }

  private async applyRecoveryStrategy(
    error: Error, 
    context: ErrorContext, 
    severity: ErrorSeverity
  ): Promise<ErrorHandlingResult> {
    const strategyKey = this.getStrategyKey(error, context);
    const strategy = this.recoveryStrategies.get(strategyKey);

    if (!strategy) {
      return { success: false, action: 'no_strategy', error };
    }

    // Check circuit breaker
    const circuitBreaker = this.circuitBreakers.get(context.operation);
    if (circuitBreaker?.isOpen()) {
      return { success: false, action: 'circuit_open', error };
    }

    // Attempt recovery with retries
    for (let attempt = 1; attempt <= (strategy.maxRetries || 1); attempt++) {
      try {
        const result = await strategy.fallbackAction(context);
        if (result.success) {
          console.log(`✅ Recovery successful on attempt ${attempt}`);
          return { success: true, action: result.action, attempt };
        }
      } catch (recoveryError) {
        console.warn(`⚠️ Recovery attempt ${attempt} failed:`, recoveryError);
        
        if (attempt < (strategy.maxRetries || 1)) {
          // Wait before retry with exponential backoff
          const delay = 1000 * Math.pow(strategy.backoffMultiplier || 2, attempt - 1);
          await this.delay(delay);
        }
      }
    }

    return { success: false, action: 'recovery_failed', error };
  }
}
```

### **Circuit Breaker Pattern**

```typescript
/**
 * Circuit Breaker for Fault Tolerance
 */

class CircuitBreaker {
  private failureCount: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private lastFailureTime: number = 0;

  constructor(
    private failureThreshold: number = 5,
    private timeout: number = 60000 // 1 minute
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }

  isOpen(): boolean {
    return this.state === 'open';
  }
}
```

---

## ⚡ **Performance Optimization**

### **Caching Strategy**

```typescript
/**
 * Multi-Level Caching for Performance
 */

class CacheManager {
  private memoryCache: Map<string, CacheEntry> = new Map();
  private diskCache: DiskCacheManager;
  private cacheStats: CacheStatistics;

  constructor() {
    this.diskCache = new DiskCacheManager();
    this.cacheStats = new CacheStatistics();
  }

  async get<T>(key: string): Promise<T | null> {
    // Level 1: Memory cache
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && !this.isExpired(memoryEntry)) {
      this.cacheStats.recordHit('memory');
      return memoryEntry.value as T;
    }

    // Level 2: Disk cache
    const diskEntry = await this.diskCache.get(key);
    if (diskEntry && !this.isExpired(diskEntry)) {
      // Promote to memory cache
      this.memoryCache.set(key, diskEntry);
      this.cacheStats.recordHit('disk');
      return diskEntry.value as T;
    }

    this.cacheStats.recordMiss();
    return null;
  }

  async set<T>(key: string, value: T, ttl: number = 3600000): Promise<void> {
    const entry: CacheEntry = {
      value,
      timestamp: Date.now(),
      ttl
    };

    // Store in memory cache
    this.memoryCache.set(key, entry);

    // Store in disk cache for larger items
    if (this.shouldPersistToDisk(entry)) {
      await this.diskCache.set(key, entry);
    }

    // Cleanup old entries
    this.cleanupMemoryCache();
  }

  private shouldPersistToDisk(entry: CacheEntry): boolean {
    const size = this.estimateSize(entry.value);
    return size > 1024 * 100; // 100KB threshold
  }

  private cleanupMemoryCache(): void {
    if (this.memoryCache.size > 1000) { // Max 1000 entries
      const sortedEntries = Array.from(this.memoryCache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp);
      
      // Remove oldest 10% of entries
      const toRemove = Math.floor(sortedEntries.length * 0.1);
      for (let i = 0; i < toRemove; i++) {
        this.memoryCache.delete(sortedEntries[i][0]);
      }
    }
  }
}

/**
 * Response Caching for Common Queries
 */

class ResponseCache extends CacheManager {
  async getCachedResponse(promptHash: string): Promise<CachedResponse | null> {
    return this.get(`response:${promptHash}`);
  }

  async cacheResponse(promptHash: string, response: string, metadata: ResponseMetadata): Promise<void> {
    const cachedResponse: CachedResponse = {
      response,
      metadata,
      timestamp: Date.now()
    };

    await this.set(`response:${promptHash}`, cachedResponse, 24 * 60 * 60 * 1000); // 24 hours
  }

  generatePromptHash(prompt: string, options: CompletionOptions): string {
    const hashInput = JSON.stringify({ prompt, options });
    return this.simpleHash(hashInput);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
}
```

### **Background Processing**

```typescript
/**
 * Background Task Management for Mobile
 */

class BackgroundProcessor {
  private taskQueue: BackgroundTask[] = [];
  private isProcessing: boolean = false;
  private maxConcurrentTasks: number = 2;
  private activeTasks: Set<string> = new Set();

  async addTask(task: BackgroundTask): Promise<string> {
    const taskId = this.generateTaskId();
    task.id = taskId;
    
    this.taskQueue.push(task);
    console.log(`📋 Added background task: ${task.type} (${taskId})`);
    
    if (!this.isProcessing) {
      this.startProcessing();
    }
    
    return taskId;
  }

  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log('⚙️ Starting background processing...');

    while (this.taskQueue.length > 0 || this.activeTasks.size > 0) {
      // Process tasks up to the concurrency limit
      while (this.activeTasks.size < this.maxConcurrentTasks && this.taskQueue.length > 0) {
        const task = this.taskQueue.shift()!;
        this.processTask(task);
      }

      // Wait a bit before checking again
      await this.delay(100);
    }

    this.isProcessing = false;
    console.log('✅ Background processing completed');
  }

  private async processTask(task: BackgroundTask): Promise<void> {
    this.activeTasks.add(task.id!);
    
    try {
      console.log(`🔄 Processing background task: ${task.type} (${task.id})`);
      
      switch (task.type) {
        case 'model_preload':
          await this.processModelPreload(task as ModelPreloadTask);
          break;
        case 'cache_cleanup':
          await this.processCacheCleanup(task as CacheCleanupTask);
          break;
        case 'conversation_sync':
          await this.processConversationSync(task as ConversationSyncTask);
          break;
        default:
          console.warn(`Unknown background task type: ${task.type}`);
      }
      
      console.log(`✅ Completed background task: ${task.type} (${task.id})`);
    } catch (error) {
      console.error(`❌ Background task failed: ${task.type} (${task.id})`, error);
    } finally {
      this.activeTasks.delete(task.id!);
    }
  }

  private async processModelPreload(task: ModelPreloadTask): Promise<void> {
    const modelManager = ModelManager.getInstance();
    await modelManager.preloadModel(task.modelId, task.priority);
  }
}
```

---

## 🔒 **Security Considerations**

### **Data Protection**

```typescript
/**
 * Security and Privacy Manager
 */

class SecurityManager {
  private encryptionKey: string;
  private sensitiveDataPattern = /\b(?:password|token|key|secret|ssn|credit.*card)\b/i;

  constructor() {
    this.encryptionKey = this.generateEncryptionKey();
  }

  async sanitizeUserInput(input: string): Promise<string> {
    // Remove potential security threats
    let sanitized = input;
    
    // Remove script tags and other dangerous HTML
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    // Remove potential injection attempts
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/data:text\/html/gi, '');
    
    // Limit length to prevent DoS
    if (sanitized.length > 10000) {
      sanitized = sanitized.substring(0, 10000);
    }

    return sanitized;
  }

  async protectSensitiveData(data: any): Promise<any> {
    if (typeof data === 'string') {
      return this.maskSensitiveStrings(data);
    }
    
    if (typeof data === 'object' && data !== null) {
      const protected = { ...data };
      for (const [key, value] of Object.entries(protected)) {
        if (this.isSensitiveField(key)) {
          protected[key] = this.maskValue(value);
        } else if (typeof value === 'object') {
          protected[key] = await this.protectSensitiveData(value);
        }
      }
      return protected;
    }

    return data;
  }

  private maskSensitiveStrings(text: string): string {
    return text.replace(this.sensitiveDataPattern, (match) => {
      return '*'.repeat(match.length);
    });
  }

  private isSensitiveField(fieldName: string): boolean {
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'creditCard'];
    return sensitiveFields.some(field => 
      fieldName.toLowerCase().includes(field.toLowerCase())
    );
  }

  async encryptConversationData(conversation: Conversation): Promise<EncryptedConversation> {
    const sensitiveMessages = conversation.messages.filter(msg => 
      this.containsSensitiveData(msg.content)
    );

    if (sensitiveMessages.length === 0) {
      return conversation as EncryptedConversation;
    }

    // Encrypt sensitive messages
    const encryptedConversation = { ...conversation };
    encryptedConversation.messages = await Promise.all(
      conversation.messages.map(async (msg) => {
        if (this.containsSensitiveData(msg.content)) {
          return {
            ...msg,
            content: await this.encrypt(msg.content),
            encrypted: true
          };
        }
        return msg;
      })
    );

    return encryptedConversation;
  }

  private containsSensitiveData(text: string): boolean {
    return this.sensitiveDataPattern.test(text);
  }
}
```

---

## 🧪 **Testing Strategy**

### **Comprehensive Testing Framework**

```typescript
/**
 * Mobile App Testing Strategy
 */

describe('LlamaApp Integration Tests', () => {
  let app: LlamaApp;
  let testModel: LlamaContext;

  beforeAll(async () => {
    // Initialize test environment
    app = new LlamaApp();
    await app.initialize();
    
    // Load test model
    testModel = await ModelManager.getInstance().loadModel({
      id: 'test-model',
      modelPath: '/test/models/tiny-test-model.gguf',
      contextSize: 512
    });
  });

  describe('Model Management', () => {
    test('should load model successfully', async () => {
      expect(testModel).toBeDefined();
      expect(testModel.metadata.id).toBe('test-model');
    });

    test('should handle model loading failure gracefully', async () => {
      const invalidConfig = {
        id: 'invalid-model',
        modelPath: '/nonexistent/model.gguf'
      };

      await expect(ModelManager.getInstance().loadModel(invalidConfig))
        .rejects.toThrow();
    });

    test('should support speculative decoding configuration', async () => {
      const speculativeModel = await ModelManager.getInstance().loadModel({
        id: 'speculative-test',
        modelPath: '/test/models/main-model.gguf',
        draftModelPath: '/test/models/draft-model.gguf',
        speculativeSamples: 3
      });

      expect(speculativeModel.speculativeEnabled).toBe(true);
    });
  });

  describe('Prompt Processing', () => {
    test('should process simple prompt correctly', async () => {
      const result = await testModel.completion({
        prompt: 'Hello, world!',
        n_predict: 10,
        temperature: 0.1
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(0);
    });

    test('should handle streaming responses', async () => {
      const tokens: string[] = [];
      
      await testModel.completion({
        prompt: 'Count to 5:',
        n_predict: 20,
        temperature: 0.1
      }, (tokenData) => {
        tokens.push(tokenData.token);
      });

      expect(tokens.length).toBeGreaterThan(0);
    });

    test('should respect token limits', async () => {
      const result = await testModel.completion({
        prompt: 'Write a very long story',
        n_predict: 5,  // Very small limit
        temperature: 0.1
      });

      const tokenCount = result.text.split(' ').length;
      expect(tokenCount).toBeLessThanOrEqual(10); // Allow some variance
    });
  });

  describe('Memory Management', () => {
    test('should handle memory pressure gracefully', async () => {
      const memoryManager = MobileMemoryManager.getInstance();
      
      // Simulate memory pressure
      await memoryManager.handleCriticalMemory();
      
      // Should still be able to generate
      const result = await testModel.completion({
        prompt: 'Test after memory cleanup',
        n_predict: 5
      });

      expect(result.text).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('should recover from inference errors', async () => {
      const errorManager = ErrorManager.getInstance();
      
      // Simulate an error scenario
      const mockError = new Error('Inference failed');
      const mockContext: ErrorContext = {
        operation: 'inference',
        modelId: 'test-model',
        timestamp: Date.now()
      };

      const result = await errorManager.handleError(mockError, mockContext);
      expect(result).toBeDefined();
    });
  });

  afterAll(async () => {
    // Cleanup
    await testModel.release();
    await app.shutdown();
  });
});

/**
 * Performance Testing
 */

describe('Performance Tests', () => {
  test('should complete inference within reasonable time', async () => {
    const startTime = Date.now();
    
    const result = await testModel.completion({
      prompt: 'Quick test',
      n_predict: 10,
      temperature: 0.1
    });
    
    const duration = Date.now() - startTime;
    
    expect(duration).toBeLessThan(10000); // 10 seconds max
    expect(result.text).toBeDefined();
  });

  test('should handle concurrent requests efficiently', async () => {
    const promises = Array.from({ length: 3 }, (_, i) =>
      testModel.completion({
        prompt: `Test ${i}`,
        n_predict: 5,
        temperature: 0.1
      })
    );

    const results = await Promise.all(promises);
    
    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result.text).toBeDefined();
    });
  });
});
```

---

## 📦 **Complete Implementation Example**

### **Main Application Class**

```typescript
/**
 * Complete LlamaApp Implementation
 */

export class LlamaApp {
  private static instance: LlamaApp;
  private isInitialized: boolean = false;
  
  private modelManager: ModelManager;
  private conversationManager: ConversationManager;
  private stateManager: StateManager;
  private errorManager: ErrorManager;
  private memoryManager: MobileMemoryManager;
  private batteryOptimizer: BatteryOptimizer;
  private cacheManager: CacheManager;
  private securityManager: SecurityManager;

  constructor() {
    this.modelManager = ModelManager.getInstance();
    this.conversationManager = ConversationManager.getInstance();
    this.stateManager = StateManager.getInstance();
    this.errorManager = ErrorManager.getInstance();
    this.memoryManager = MobileMemoryManager.getInstance();
    this.batteryOptimizer = BatteryOptimizer.getInstance();
    this.cacheManager = CacheManager.getInstance();
    this.securityManager = SecurityManager.getInstance();
  }

  static getInstance(): LlamaApp {
    if (!LlamaApp.instance) {
      LlamaApp.instance = new LlamaApp();
    }
    return LlamaApp.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('🚀 Initializing LlamaApp...');

    try {
      // Initialize all managers
      await Promise.all([
        this.stateManager.initialize(),
        this.memoryManager.startMemoryMonitoring(),
        this.batteryOptimizer.initializeBatteryMonitoring(),
        this.modelManager.initialize(),
        this.errorManager.initialize()
      ]);

      // Setup event listeners
      this.setupEventListeners();

      // Start background services
      await this.startBackgroundServices();

      this.isInitialized = true;
      console.log('✅ LlamaApp initialized successfully');

    } catch (error) {
      console.error('❌ LlamaApp initialization failed:', error);
      throw error;
    }
  }

  // Public API Methods
  async createConversation(config?: ConversationConfig): Promise<string> {
    this.ensureInitialized();
    return this.conversationManager.createConversation(config || {});
  }

  async sendMessage(conversationId: string, message: string): Promise<string> {
    this.ensureInitialized();
    
    try {
      // Sanitize input
      const sanitizedMessage = await this.securityManager.sanitizeUserInput(message);
      
      // Get conversation context
      const context = await this.conversationManager.getConversationContext(conversationId);
      
      // Get appropriate model
      const model = await this.modelManager.getModelForConversation(context);
      
      // Process prompt
      const processedPrompt = await this.processPrompt(sanitizedMessage, context);
      
      // Check cache first
      const cacheKey = this.cacheManager.generatePromptHash(processedPrompt.prompt, context.options);
      const cachedResponse = await this.cacheManager.getCachedResponse(cacheKey);
      
      if (cachedResponse) {
        console.log('📦 Using cached response');
        return cachedResponse.response;
      }

      // Generate response
      const response = await this.generateResponse(model, processedPrompt, context);
      
      // Cache response
      await this.cacheManager.cacheResponse(cacheKey, response, {
        modelId: model.metadata.id,
        timestamp: Date.now()
      });
      
      // Add to conversation
      await this.conversationManager.addMessage(conversationId, {
        role: 'user',
        content: sanitizedMessage,
        timestamp: Date.now()
      });
      
      await this.conversationManager.addMessage(conversationId, {
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      });

      return response;

    } catch (error) {
      console.error(`❌ Failed to send message in conversation ${conversationId}:`, error);
      
      // Handle error with recovery
      const errorContext: ErrorContext = {
        operation: 'send_message',
        conversationId,
        timestamp: Date.now()
      };
      
      await this.errorManager.handleError(error as Error, errorContext);
      
      throw error;
    }
  }

  async sendStreamingMessage(
    conversationId: string, 
    message: string,
    onToken: (token: string) => void
  ): Promise<string> {
    this.ensureInitialized();
    
    const sanitizedMessage = await this.securityManager.sanitizeUserInput(message);
    const context = await this.conversationManager.getConversationContext(conversationId);
    const model = await this.modelManager.getModelForConversation(context);
    const processedPrompt = await this.processPrompt(sanitizedMessage, context);

    let fullResponse = '';

    const result = await model.completion({
      prompt: processedPrompt.prompt,
      n_predict: context.maxTokens,
      temperature: context.temperature,
      
      // Mobile optimizations
      top_k: 40,
      top_p: 0.9,
      repeat_penalty: 1.1
      
    }, (tokenData) => {
      fullResponse += tokenData.token;
      onToken(tokenData.token);
    });

    // Add messages to conversation
    await this.conversationManager.addMessage(conversationId, {
      role: 'user',
      content: sanitizedMessage,
      timestamp: Date.now()
    });
    
    await this.conversationManager.addMessage(conversationId, {
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now()
    });

    return fullResponse;
  }

  async getConversations(): Promise<Conversation[]> {
    this.ensureInitialized();
    return this.conversationManager.getAllConversations();
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.ensureInitialized();
    return this.conversationManager.deleteConversation(conversationId);
  }

  async getModelStatus(): Promise<ModelStatus[]> {
    this.ensureInitialized();
    return this.modelManager.getModelStatus();
  }

  async shutdown(): Promise<void> {
    console.log('🔄 Shutting down LlamaApp...');
    
    try {
      // Release all models
      await this.modelManager.releaseAllModels();
      
      // Stop background services
      this.memoryManager.stopMemoryMonitoring();
      
      // Persist state
      await this.stateManager.persistState();
      
      this.isInitialized = false;
      console.log('✅ LlamaApp shutdown completed');
      
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
  }

  // Private helper methods
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('LlamaApp is not initialized. Call initialize() first.');
    }
  }

  private setupEventListeners(): void {
    // Listen for app lifecycle events
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.handleAppBackground();
      } else {
        this.handleAppForeground();
      }
    });

    // Listen for memory warnings
    if ('memory' in performance) {
      setInterval(() => {
        const memInfo = (performance as any).memory;
        if (memInfo.usedJSHeapSize / memInfo.totalJSHeapSize > 0.8) {
          this.memoryManager.handleWarningMemory();
        }
      }, 30000); // Check every 30 seconds
    }
  }

  private async handleAppBackground(): Promise<void> {
    console.log('📱 App moving to background');
    
    // Reduce memory usage
    await this.modelManager.releaseInactiveModels();
    
    // Persist important state
    await this.stateManager.persistCriticalState();
  }

  private async handleAppForeground(): Promise<void> {
    console.log('📱 App returning to foreground');
    
    // Preload frequently used models
    await this.modelManager.preloadFrequentModels();
  }
}

// Export singleton instance
export const llamaApp = LlamaApp.getInstance();
```

---

## 🎯 **Usage Examples**

### **React/React Native Component**

```typescript
/**
 * Example React Component using LlamaApp
 */

import React, { useState, useEffect } from 'react';
import { llamaApp } from './LlamaApp';

const ChatInterface: React.FC = () => {
  const [conversationId, setConversationId] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(true);

  useEffect(() => {
    initializeChat();
  }, []);

  const initializeChat = async () => {
    try {
      // Initialize app
      await llamaApp.initialize();
      
      // Create new conversation
      const convId = await llamaApp.createConversation({
        title: 'New Chat',
        modelId: 'primary-chat'
      });
      
      setConversationId(convId);
      setIsModelLoading(false);
      
    } catch (error) {
      console.error('Failed to initialize chat:', error);
      setIsModelLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to UI immediately
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    }]);

    try {
      // Add placeholder for assistant response
      const assistantMessageIndex = messages.length + 1;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true
      }]);

      // Send streaming message
      await llamaApp.sendStreamingMessage(
        conversationId,
        userMessage,
        (token: string) => {
          // Update the assistant message with each token
          setMessages(prev => {
            const newMessages = [...prev];
            if (newMessages[assistantMessageIndex]) {
              newMessages[assistantMessageIndex].content += token;
            }
            return newMessages;
          });
        }
      );

      // Mark streaming as complete
      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages[assistantMessageIndex]) {
          newMessages[assistantMessageIndex].isStreaming = false;
        }
        return newMessages;
      });

    } catch (error) {
      console.error('Failed to send message:', error);
      
      // Show error message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now(),
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (isModelLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading AI model...</p>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {messages.map((message, index) => (
          <div 
            key={index} 
            className={`message ${message.role} ${message.isStreaming ? 'streaming' : ''}`}
          >
            <div className="message-content">
              {message.content}
              {message.isStreaming && <span className="cursor">|</span>}
            </div>
            {message.isError && (
              <div className="error-indicator">⚠️</div>
            )}
          </div>
        ))}
      </div>
      
      <div className="input-container">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button 
          onClick={sendMessage} 
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
};

export default ChatInterface;
```

---

## 📋 **Summary & Best Practices**

### **Key Architectural Decisions**

1. **Layered Architecture**: Clear separation between UI, business logic, and native bridge
2. **Singleton Pattern**: Consistent state management across the application
3. **Event-Driven**: Loose coupling between components via event bus
4. **Mobile-First**: All decisions optimized for mobile constraints
5. **Fault-Tolerant**: Comprehensive error handling and recovery strategies

### **Performance Optimizations**

1. **Speculative Decoding**: 2-8x faster inference with mobile optimizations
2. **Multi-Level Caching**: Memory and disk caching for responses and models
3. **Background Processing**: Non-blocking operations for better UX
4. **Resource Management**: Dynamic resource allocation based on device state
5. **Context Window Management**: Sliding window for long conversations

### **Mobile Considerations**

1. **Battery Optimization**: Performance modes based on battery level and charging state
2. **Memory Management**: Proactive cleanup and emergency handling
3. **Network Awareness**: Different strategies for WiFi vs cellular
4. **App Lifecycle**: Proper handling of background/foreground transitions
5. **Storage Management**: Efficient model and cache storage

### **Security & Privacy**

1. **Input Sanitization**: Protection against injection attacks
2. **Sensitive Data Detection**: Automatic masking of sensitive information
3. **Local Processing**: All AI processing happens on-device
4. **Encryption**: Optional encryption for sensitive conversations
5. **Data Minimization**: Automatic cleanup of old data

This architecture provides a robust, scalable, and maintainable foundation for building mobile applications with the llama-cpp-capacitor plugin, ensuring optimal performance and user experience across different mobile platforms and device capabilities.
