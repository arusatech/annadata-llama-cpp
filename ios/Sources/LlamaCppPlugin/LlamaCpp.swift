import Foundation

// MARK: - Native Library Integration
private var contexts: [Int64: UnsafeMutableRawPointer] = [:]
private var nextContextId: Int64 = 1

// Load the native library
private lazy var llamaLibrary: UnsafeMutableRawPointer? = {
    guard let libraryPath = Bundle.main.path(forResource: "llama-cpp", ofType: "framework") else {
        print("Error: llama-cpp framework not found")
        return nil
    }
    
    guard let handle = dlopen(libraryPath, RTLD_NOW) else {
        print("Error: Failed to load llama-cpp library: \(String(cString: dlerror()))")
        return nil
    }
    
    return handle
}()

// Function pointers for native calls
private var initContextFunc: ((String, UnsafePointer<Int8>) -> Int64)?
private var releaseContextFunc: ((Int64) -> Void)?
private var completionFunc: ((Int64, String, UnsafePointer<Int8>) -> String?)?
private var stopCompletionFunc: ((Int64) -> Void)?
private var getFormattedChatFunc: ((Int64, String, String) -> String?)?
private var toggleNativeLogFunc: ((Bool) -> Bool)?

private func loadFunctionPointers() {
    guard let library = llamaLibrary else { return }
    
    // Load function pointers from the native library
    initContextFunc = unsafeBitCast(dlsym(library, "llama_init_context"), to: ((String, UnsafePointer<Int8>) -> Int64).self)
    releaseContextFunc = unsafeBitCast(dlsym(library, "llama_release_context"), to: ((Int64) -> Void).self)
    completionFunc = unsafeBitCast(dlsym(library, "llama_completion"), to: ((Int64, String, UnsafePointer<Int8>) -> String?).self)
    stopCompletionFunc = unsafeBitCast(dlsym(library, "llama_stop_completion"), to: ((Int64) -> Void).self)
    getFormattedChatFunc = unsafeBitCast(dlsym(library, "llama_get_formatted_chat"), to: ((Int64, String, String) -> String?).self)
    toggleNativeLogFunc = unsafeBitCast(dlsym(library, "llama_toggle_native_log"), to: ((Bool) -> Bool).self)
}

// MARK: - Result Types
typealias LlamaResult<T> = Result<T, LlamaError>

enum LlamaError: Error, LocalizedError {
    case contextNotFound
    case modelNotFound
    case invalidParameters
    case operationFailed(String)
    case notImplemented
    
    var errorDescription: String? {
        switch self {
        case .contextNotFound:
            return "Context not found"
        case .modelNotFound:
            return "Model not found"
        case .invalidParameters:
            return "Invalid parameters"
        case .operationFailed(let message):
            return "Operation failed: \(message)"
        case .notImplemented:
            return "Operation not implemented"
        }
    }
}

// MARK: - Context Management
class LlamaContext {
    let id: Int
    var model: LlamaModel?
    var isMultimodalEnabled: Bool = false
    var isVocoderEnabled: Bool = false
    
    init(id: Int) {
        self.id = id
    }
}

class LlamaModel {
    let path: String
    let desc: String
    let size: Int
    let nEmbd: Int
    let nParams: Int
    let chatTemplates: ChatTemplates
    let metadata: [String: Any]
    
    init(path: String, desc: String, size: Int, nEmbd: Int, nParams: Int, chatTemplates: ChatTemplates, metadata: [String: Any]) {
        self.path = path
        self.desc = desc
        self.size = size
        self.nEmbd = nEmbd
        self.nParams = nParams
        self.chatTemplates = chatTemplates
        self.metadata = metadata
    }
}

struct ChatTemplates {
    let llamaChat: Bool
    let minja: MinjaTemplates
    
    init(llamaChat: Bool, minja: MinjaTemplates) {
        self.llamaChat = llamaChat
        self.minja = minja
    }
}

struct MinjaTemplates {
    let `default`: Bool
    let defaultCaps: MinjaCaps
    let toolUse: Bool
    let toolUseCaps: MinjaCaps
    
    init(default: Bool, defaultCaps: MinjaCaps, toolUse: Bool, toolUseCaps: MinjaCaps) {
        self.default = `default`
        self.defaultCaps = defaultCaps
        self.toolUse = toolUse
        self.toolUseCaps = toolUseCaps
    }
}

struct MinjaCaps {
    let tools: Bool
    let toolCalls: Bool
    let toolResponses: Bool
    let systemRole: Bool
    let parallelToolCalls: Bool
    let toolCallId: Bool
    
    init(tools: Bool, toolCalls: Bool, toolResponses: Bool, systemRole: Bool, parallelToolCalls: Bool, toolCallId: Bool) {
        self.tools = tools
        self.toolCalls = toolCalls
        self.toolResponses = toolResponses
        self.systemRole = systemRole
        self.parallelToolCalls = parallelToolCalls
        self.toolCallId = toolCallId
    }
}

// MARK: - Main Implementation
@objc public class LlamaCpp: NSObject {
    private var contexts: [Int: LlamaContext] = [:]
    private var contextCounter: Int = 0
    private var contextLimit: Int = 10
    private var nativeLogEnabled: Bool = false
    
    // MARK: - Core initialization and management
    
    func toggleNativeLog(enabled: Bool, completion: @escaping (LlamaResult<Void>) -> Void) {
        nativeLogEnabled = enabled
        if enabled {
            print("[LlamaCpp] Native logging enabled")
        } else {
            print("[LlamaCpp] Native logging disabled")
        }
        completion(.success(()))
    }
    
    func setContextLimit(limit: Int, completion: @escaping (LlamaResult<Void>) -> Void) {
        contextLimit = limit
        print("[LlamaCpp] Context limit set to \(limit)")
        completion(.success(()))
    }
    
    func modelInfo(path: String, skip: [String], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        // This would typically load model info from the GGUF file
        // For now, return a basic structure
        let modelInfo: [String: Any] = [
            "path": path,
            "desc": "Sample model",
            "size": 0,
            "nEmbd": 0,
            "nParams": 0
        ]
        completion(.success(modelInfo))
    }
    
    func initContext(contextId: Int, params: [String: Any], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        // Check context limit
        if contexts.count >= contextLimit {
            completion(.failure(.operationFailed("Context limit reached")))
            return
        }
        
        // Extract parameters
        guard let modelPath = params["model"] as? String else {
            completion(.failure(.invalidParameters))
            return
        }
        
        // Create context
        let context = LlamaContext(id: contextId)
        
        // Create model info (this would typically load from GGUF file)
        let chatTemplates = ChatTemplates(
            llamaChat: true,
            minja: MinjaTemplates(
                default: true,
                defaultCaps: MinjaCaps(
                    tools: true,
                    toolCalls: true,
                    toolResponses: true,
                    systemRole: true,
                    parallelToolCalls: true,
                    toolCallId: true
                ),
                toolUse: true,
                toolUseCaps: MinjaCaps(
                    tools: true,
                    toolCalls: true,
                    toolResponses: true,
                    systemRole: true,
                    parallelToolCalls: true,
                    toolCallId: true
                )
            )
        )
        
        let model = LlamaModel(
            path: modelPath,
            desc: "Sample model",
            size: 0,
            nEmbd: 0,
            nParams: 0,
            chatTemplates: chatTemplates,
            metadata: [:]
        )
        
        context.model = model
        contexts[contextId] = context
        
        // Return context info
        let contextInfo: [String: Any] = [
            "contextId": contextId,
            "gpu": false,
            "reasonNoGPU": "Not implemented",
            "model": [
                "desc": model.desc,
                "size": model.size,
                "nEmbd": model.nEmbd,
                "nParams": model.nParams,
                "chatTemplates": [
                    "llamaChat": model.chatTemplates.llamaChat,
                    "minja": [
                        "default": model.chatTemplates.minja.default,
                        "defaultCaps": [
                            "tools": model.chatTemplates.minja.defaultCaps.tools,
                            "toolCalls": model.chatTemplates.minja.defaultCaps.toolCalls,
                            "toolResponses": model.chatTemplates.minja.defaultCaps.toolResponses,
                            "systemRole": model.chatTemplates.minja.defaultCaps.systemRole,
                            "parallelToolCalls": model.chatTemplates.minja.defaultCaps.parallelToolCalls,
                            "toolCallId": model.chatTemplates.minja.defaultCaps.toolCallId
                        ],
                        "toolUse": model.chatTemplates.minja.toolUse,
                        "toolUseCaps": [
                            "tools": model.chatTemplates.minja.toolUseCaps.tools,
                            "toolCalls": model.chatTemplates.minja.toolUseCaps.toolCalls,
                            "toolResponses": model.chatTemplates.minja.toolUseCaps.toolResponses,
                            "systemRole": model.chatTemplates.minja.toolUseCaps.systemRole,
                            "parallelToolCalls": model.chatTemplates.minja.toolUseCaps.parallelToolCalls,
                            "toolCallId": model.chatTemplates.minja.toolUseCaps.toolCallId
                        ]
                    ]
                ],
                "metadata": model.metadata,
                "isChatTemplateSupported": true
            ]
        ]
        
        completion(.success(contextInfo))
    }
    
    func releaseContext(contextId: Int, completion: @escaping (LlamaResult<Void>) -> Void) {
        guard contexts.removeValue(forKey: contextId) != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        completion(.success(()))
    }
    
    func releaseAllContexts(completion: @escaping (LlamaResult<Void>) -> Void) {
        contexts.removeAll()
        completion(.success(()))
    }
    
    // MARK: - Chat and completion
    
    func getFormattedChat(contextId: Int, messages: String, chatTemplate: String?, params: [String: Any]?, completion: @escaping (LlamaResult<Any>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically format the chat using the model's chat templates
        // For now, return a basic formatted chat
        let formattedChat: [String: Any] = [
            "type": "llama-chat",
            "prompt": messages,
            "has_media": false,
            "media_paths": []
        ]
        
        completion(.success(formattedChat))
    }
    
    func completion(contextId: Int, params: [String: Any], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically perform the completion using llama.cpp
        // For now, return a basic completion result
        let completionResult: [String: Any] = [
            "text": "Sample completion text",
            "reasoning_content": "",
            "tool_calls": [],
            "content": "Sample completion text",
            "chat_format": 0,
            "tokens_predicted": 0,
            "tokens_evaluated": 0,
            "truncated": false,
            "stopped_eos": false,
            "stopped_word": "",
            "stopped_limit": 0,
            "stopping_word": "",
            "context_full": false,
            "interrupted": false,
            "tokens_cached": 0,
            "timings": [
                "prompt_n": 0,
                "prompt_ms": 0,
                "prompt_per_token_ms": 0,
                "prompt_per_second": 0,
                "predicted_n": 0,
                "predicted_ms": 0,
                "predicted_per_token_ms": 0,
                "predicted_per_second": 0
            ]
        ]
        
        completion(.success(completionResult))
    }
    
    func stopCompletion(contextId: Int, completion: @escaping (LlamaResult<Void>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically stop any ongoing completion
        completion(.success(()))
    }
    
    // MARK: - Chat-first methods (like llama-cli -sys)
    
    func chat(contextId: Int, messages: [JSObject], system: String?, chatTemplate: String?, params: [String: Any]?, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        do {
            // Convert JSObject messages to JSON string
            let messagesData = try JSONSerialization.data(withJSONObject: messages)
            let messagesJson = String(data: messagesData, encoding: .utf8) ?? "[]"
            
            // Add system message if provided
            var allMessages = messages
            if let system = system, !system.isEmpty {
                let systemMessage: [String: Any] = [
                    "role": "system",
                    "content": system
                ]
                allMessages.insert(JSObject(systemMessage), at: 0)
            }
            
            // Convert to JSON string for getFormattedChat
            let allMessagesData = try JSONSerialization.data(withJSONObject: allMessages.map { $0.dictionary })
            let allMessagesJson = String(data: allMessagesData, encoding: .utf8) ?? "[]"
            
            // First, format the chat
            getFormattedChat(contextId: contextId, messages: allMessagesJson, chatTemplate: chatTemplate, params: nil) { [weak self] result in
                switch result {
                case .success(let formattedResult):
                    // Extract the formatted prompt
                    let formattedPrompt = formattedResult["prompt"] as? String ?? ""
                    
                    // Create completion parameters
                    var completionParams = params ?? [:]
                    completionParams["prompt"] = formattedPrompt
                    
                    // Call completion with formatted prompt
                    self?.completion(contextId: contextId, params: completionParams, completion: completion)
                    
                case .failure(let error):
                    completion(.failure(error))
                }
            }
            
        } catch {
            completion(.failure(.contextNotFound)) // Use a more appropriate error
        }
    }
    
    func chatWithSystem(contextId: Int, system: String, message: String, params: [String: Any]?, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        // Create a simple message array
        let userMessage: [String: Any] = [
            "role": "user",
            "content": message
        ]
        
        let messages = [JSObject(userMessage)]
        
        // Call the main chat method
        chat(contextId: contextId, messages: messages, system: system, chatTemplate: nil, params: params, completion: completion)
    }
    
    func generateText(contextId: Int, prompt: String, params: [String: Any]?, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // Create completion parameters
        var completionParams = params ?? [:]
        completionParams["prompt"] = prompt
        
        // Call completion directly
        completion(contextId: contextId, params: completionParams, completion: completion)
    }
    
    // MARK: - Session management
    
    func loadSession(contextId: Int, filepath: String, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically load session from file
        let sessionResult: [String: Any] = [
            "tokens_loaded": 0,
            "prompt": ""
        ]
        
        completion(.success(sessionResult))
    }
    
    func saveSession(contextId: Int, filepath: String, size: Int, completion: @escaping (LlamaResult<Int>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically save session to file
        completion(.success(0))
    }
    
    // MARK: - Tokenization
    
    func tokenize(contextId: Int, text: String, imagePaths: [String], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically tokenize the text using the model's tokenizer
        let tokenizeResult: [String: Any] = [
            "tokens": [],
            "has_images": false,
            "bitmap_hashes": [],
            "chunk_pos": [],
            "chunk_pos_images": []
        ]
        
        completion(.success(tokenizeResult))
    }
    
    func detokenize(contextId: Int, tokens: [Int], completion: @escaping (LlamaResult<String>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically detokenize using the model's tokenizer
        completion(.success(""))
    }
    
    // MARK: - Embeddings and reranking
    
    func embedding(contextId: Int, text: String, params: [String: Any], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically generate embeddings
        let embeddingResult: [String: Any] = [
            "embedding": []
        ]
        
        completion(.success(embeddingResult))
    }
    
    func rerank(contextId: Int, query: String, documents: [String], params: [String: Any]?, completion: @escaping (LlamaResult<[[String: Any]]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically perform reranking
        let rerankResults: [[String: Any]] = []
        completion(.success(rerankResults))
    }
    
    // MARK: - Benchmarking
    
    func bench(contextId: Int, pp: Int, tg: Int, pl: Int, nr: Int, completion: @escaping (LlamaResult<String>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically run benchmarks
        let benchResult = "[]"
        completion(.success(benchResult))
    }
    
    // MARK: - LoRA adapters
    
    func applyLoraAdapters(contextId: Int, loraAdapters: [[String: Any]], completion: @escaping (LlamaResult<Void>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically apply LoRA adapters
        completion(.success(()))
    }
    
    func removeLoraAdapters(contextId: Int, completion: @escaping (LlamaResult<Void>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically remove LoRA adapters
        completion(.success(()))
    }
    
    func getLoadedLoraAdapters(contextId: Int, completion: @escaping (LlamaResult<[[String: Any]]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // This would typically return loaded LoRA adapters
        let adapters: [[String: Any]] = []
        completion(.success(adapters))
    }
    
    // MARK: - Multimodal methods
    
    func initMultimodal(contextId: Int, path: String, useGpu: Bool, completion: @escaping (LlamaResult<Bool>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        context.isMultimodalEnabled = true
        completion(.success(true))
    }
    
    func isMultimodalEnabled(contextId: Int, completion: @escaping (LlamaResult<Bool>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        completion(.success(context.isMultimodalEnabled))
    }
    
    func getMultimodalSupport(contextId: Int, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        let support: [String: Any] = [
            "vision": true,
            "audio": true
        ]
        
        completion(.success(support))
    }
    
    func releaseMultimodal(contextId: Int, completion: @escaping (LlamaResult<Void>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        context.isMultimodalEnabled = false
        completion(.success(()))
    }
    
    // MARK: - TTS methods
    
    func initVocoder(contextId: Int, path: String, nBatch: Int?, completion: @escaping (LlamaResult<Bool>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        context.isVocoderEnabled = true
        completion(.success(true))
    }
    
    func isVocoderEnabled(contextId: Int, completion: @escaping (LlamaResult<Bool>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        completion(.success(context.isVocoderEnabled))
    }
    
    func getFormattedAudioCompletion(contextId: Int, speakerJsonStr: String, textToSpeak: String, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        let audioCompletion: [String: Any] = [
            "prompt": "",
            "grammar": nil
        ]
        
        completion(.success(audioCompletion))
    }
    
    func getAudioCompletionGuideTokens(contextId: Int, textToSpeak: String, completion: @escaping (LlamaResult<[Int]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        let tokens: [Int] = []
        completion(.success(tokens))
    }
    
    func decodeAudioTokens(contextId: Int, tokens: [Int], completion: @escaping (LlamaResult<[Int]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        let decodedTokens: [Int] = []
        completion(.success(decodedTokens))
    }
    
    func releaseVocoder(contextId: Int, completion: @escaping (LlamaResult<Void>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        context.isVocoderEnabled = false
        completion(.success(()))
    }
}
