import Foundation
import Capacitor

// MARK: - Native Library Integration

private enum LibraryLoader {
    /// dlopen must target the framework Mach-O (`llama-cpp.framework/llama-cpp`), not the `.framework` directory.
    static var llamaLibrary: UnsafeMutableRawPointer? = {
        let fm = FileManager.default
        var candidates: [String] = []
        if let fw = Bundle.main.path(forResource: "llama-cpp", ofType: "framework") {
            candidates.append((fw as NSString).appendingPathComponent("llama-cpp"))
        }
        if let exec = Bundle.main.executablePath {
            let frameworks = (exec as NSString).deletingLastPathComponent + "/Frameworks/llama-cpp.framework/llama-cpp"
            candidates.append(frameworks)
        }
        for path in candidates where fm.fileExists(atPath: path) {
            guard let handle = dlopen(path, RTLD_NOW) else {
                print("[LlamaCpp] dlopen failed for \(path): \(String(cString: dlerror()))")
                continue
            }
            return handle
        }
        print("[LlamaCpp] llama-cpp framework binary not found; tried: \(candidates)")
        return nil
    }()
}

private var llamaLibrary: UnsafeMutableRawPointer? { LibraryLoader.llamaLibrary }

private typealias NativeInitContext = @convention(c) (UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> Int64
private typealias NativeReleaseContext = @convention(c) (Int64) -> Void
private typealias NativeCompletion = @convention(c) (Int64, UnsafePointer<CChar>?) -> UnsafePointer<CChar>?
private typealias NativeGetContextModelJson = @convention(c) (Int64) -> UnsafePointer<CChar>?
private typealias NativeGetFormattedChat = @convention(c) (Int64, UnsafePointer<CChar>?, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> UnsafePointer<CChar>?
private typealias NativeToggleLog = @convention(c) (Bool) -> Bool
private typealias NativeEmbedding = @convention(c) (Int64, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> UnsafePointer<Float>?
private typealias NativeRegisterEmb = @convention(c) (Int64, UnsafeMutableRawPointer?) -> Void
private typealias NativeUnregisterEmb = @convention(c) (Int64) -> Void
private typealias NativeModelInfo = @convention(c) (UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> UnsafePointer<CChar>?
private typealias NativeTokenize = @convention(c) (Int64, UnsafePointer<CChar>?, UnsafePointer<CChar>?) -> UnsafePointer<CChar>?
private typealias NativeDetokenize = @convention(c) (Int64, UnsafePointer<CChar>?) -> UnsafePointer<CChar>?
private typealias NativeGrammar = @convention(c) (UnsafePointer<CChar>?) -> UnsafePointer<CChar>?
private typealias NativeCapServerStart = @convention(c) (UnsafePointer<CChar>?, UnsafePointer<CChar>?, Int32, UnsafePointer<CChar>?) -> Int32
private typealias NativeCapServerStop = @convention(c) () -> Void
private typealias NativeCapServerIsRunning = @convention(c) () -> Int32

private var initContextFunc: NativeInitContext?
private var releaseContextFunc: NativeReleaseContext?
private var completionFunc: NativeCompletion?
private var getContextModelJsonFunc: NativeGetContextModelJson?
private var stopCompletionFunc: NativeReleaseContext?
private var getFormattedChatFunc: NativeGetFormattedChat?
private var toggleNativeLogFunc: NativeToggleLog?
private var embeddingFunc: NativeEmbedding?
private var registerEmbeddingContextFunc: NativeRegisterEmb?
private var unregisterEmbeddingContextFunc: NativeUnregisterEmb?
private var modelInfoFunc: NativeModelInfo?
private var tokenizeFunc: NativeTokenize?
private var detokenizeFunc: NativeDetokenize?
private var grammarFunc: NativeGrammar?
private var capServerStartFunc: NativeCapServerStart?
private var capServerStopFunc: NativeCapServerStop?
private var capServerIsRunningFunc: NativeCapServerIsRunning?

private func loadFunctionPointers() {
    guard let library = llamaLibrary else { return }
    func sym<T>(_ name: String, _ type: T.Type) -> T? {
        guard let p = dlsym(library, name) else { return nil }
        return unsafeBitCast(p, to: T.self)
    }
    initContextFunc = sym("llama_init_context", NativeInitContext.self)
    releaseContextFunc = sym("llama_release_context", NativeReleaseContext.self)
    completionFunc = sym("llama_completion", NativeCompletion.self)
    getContextModelJsonFunc = sym("llama_get_context_model_json", NativeGetContextModelJson.self)
    stopCompletionFunc = sym("llama_stop_completion", NativeReleaseContext.self)
    getFormattedChatFunc = sym("llama_get_formatted_chat", NativeGetFormattedChat.self)
    toggleNativeLogFunc = sym("llama_toggle_native_log", NativeToggleLog.self)
    embeddingFunc = sym("llama_embedding", NativeEmbedding.self)
    registerEmbeddingContextFunc = sym("llama_embedding_register_context", NativeRegisterEmb.self)
    unregisterEmbeddingContextFunc = sym("llama_embedding_unregister_context", NativeUnregisterEmb.self)
    modelInfoFunc = sym("llama_model_info", NativeModelInfo.self)
    tokenizeFunc = sym("llama_tokenize", NativeTokenize.self)
    detokenizeFunc = sym("llama_detokenize", NativeDetokenize.self)
    grammarFunc = sym("llama_convert_json_schema_to_grammar", NativeGrammar.self)
    capServerStartFunc = sym("cap_llama_server_start", NativeCapServerStart.self)
    capServerStopFunc = sym("cap_llama_server_stop", NativeCapServerStop.self)
    capServerIsRunningFunc = sym("cap_llama_server_is_running", NativeCapServerIsRunning.self)
}

private func jsonObject(fromCString p: UnsafePointer<CChar>?) -> [String: Any]? {
    guard let p = p else { return nil }
    let s = String(cString: p)
    guard let d = s.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
    return obj
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
    var desc: String
    var size: Int
    var nEmbd: Int
    var nParams: Int
    var chatTemplates: ChatTemplates
    var metadata: [String: Any]
    
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
    private var nativeContexts: [Int64: UnsafeMutableRawPointer] = [:]
    private var contextIdToNative: [Int: Int64] = [:]
    private var contextCounter: Int = 0
    private var contextLimit: Int = 10
    private var nativeLogEnabled: Bool = false
    
    // MARK: - Core initialization and management
    
    func toggleNativeLog(enabled: Bool, completion: @escaping (LlamaResult<Void>) -> Void) {
        nativeLogEnabled = enabled
        if initContextFunc == nil { loadFunctionPointers() }
        if let fn = toggleNativeLogFunc {
            _ = fn(enabled)
        }
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
        if modelInfoFunc == nil { loadFunctionPointers() }
        guard let fn = modelInfoFunc else {
            completion(.failure(.operationFailed("llama_model_info not found")))
            return
        }
        var skipJson = "[]"
        if !skip.isEmpty, let d = try? JSONSerialization.data(withJSONObject: skip), let s = String(data: d, encoding: .utf8) {
            skipJson = s
        }
        let result: LlamaResult<[String: Any]> = path.withCString { pathPtr in
            skipJson.withCString { skipPtr in
                guard let c = fn(pathPtr, skipPtr), let dict = jsonObject(fromCString: c) else {
                    return .failure(.operationFailed("model info failed"))
                }
                if let err = dict["error"] as? String {
                    return .failure(.operationFailed(err))
                }
                return .success(dict)
            }
        }
        completion(result)
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
        
        let defaultCaps = MinjaCaps(
            tools: true,
            toolCalls: true,
            toolResponses: true,
            systemRole: true,
            parallelToolCalls: true,
            toolCallId: true
        )
        let defaultTemplates = ChatTemplates(
            llamaChat: true,
            minja: MinjaTemplates(
                default: true,
                defaultCaps: defaultCaps,
                toolUse: true,
                toolUseCaps: defaultCaps
            )
        )
        
        var model = LlamaModel(
            path: modelPath,
            desc: "model",
            size: 0,
            nEmbd: 0,
            nParams: 0,
            chatTemplates: defaultTemplates,
            metadata: [:]
        )
        
        context.model = model
        
        var paramsJson = "{}"
        do {
            let paramsData = try JSONSerialization.data(withJSONObject: params)
            paramsJson = String(data: paramsData, encoding: .utf8) ?? "{}"
        } catch {
            completion(.failure(.operationFailed("Failed to serialize params: \(error.localizedDescription)")))
            return
        }
        
        if initContextFunc == nil {
            loadFunctionPointers()
        }
        
        guard let initFunc = initContextFunc else {
            completion(.failure(.operationFailed("Native initContext function not available")))
            return
        }
        
        let nativeContextId: Int64 = modelPath.withCString { modelPtr in
            paramsJson.withCString { paramsPtr in
                initFunc(modelPtr, paramsPtr)
            }
        }
        
        guard nativeContextId > 0 else {
            completion(.failure(.operationFailed("Failed to initialize native context")))
            return
        }
        
        contexts[contextId] = context
        nativeContexts[nativeContextId] = UnsafeMutableRawPointer(bitPattern: Int(truncatingIfNeeded: nativeContextId))
        contextIdToNative[contextId] = nativeContextId
        
        if let jsonFn = getContextModelJsonFunc, let c = jsonFn(nativeContextId), let m = jsonObject(fromCString: c) {
            model.desc = (m["desc"] as? String) ?? model.desc
            if let n = m["size"] as? NSNumber { model.size = n.intValue }
            if let n = m["nEmbd"] as? NSNumber { model.nEmbd = n.intValue }
            if let n = m["nParams"] as? NSNumber { model.nParams = n.intValue }
            if let meta = m["metadata"] as? [String: Any] { model.metadata = meta }
            if let ct = m["chatTemplates"] as? [String: Any] {
                let llamaChat = (ct["llamaChat"] as? NSNumber)?.boolValue ?? true
                if let minja = ct["minja"] as? [String: Any] {
                    func caps(_ d: [String: Any]?) -> MinjaCaps {
                        guard let d = d else {
                            return defaultCaps
                        }
                        return MinjaCaps(
                            tools: (d["tools"] as? NSNumber)?.boolValue ?? true,
                            toolCalls: (d["toolCalls"] as? NSNumber)?.boolValue ?? true,
                            toolResponses: (d["toolResponses"] as? NSNumber)?.boolValue ?? true,
                            systemRole: (d["systemRole"] as? NSNumber)?.boolValue ?? true,
                            parallelToolCalls: (d["parallelToolCalls"] as? NSNumber)?.boolValue ?? true,
                            toolCallId: (d["toolCallId"] as? NSNumber)?.boolValue ?? true
                        )
                    }
                    let defCaps = caps(minja["defaultCaps"] as? [String: Any])
                    let tuCaps = caps(minja["toolUseCaps"] as? [String: Any])
                    model.chatTemplates = ChatTemplates(
                        llamaChat: llamaChat,
                        minja: MinjaTemplates(
                            default: (minja["default"] as? NSNumber)?.boolValue ?? true,
                            defaultCaps: defCaps,
                            toolUse: (minja["toolUse"] as? NSNumber)?.boolValue ?? true,
                            toolUseCaps: tuCaps
                        )
                    )
                }
            }
            context.model = model
        }
        
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
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        
        let nativeId = contextIdToNative[contextId] ?? Int64(contextId)
        
        // Unregister from embedding system if available
        if let unregisterFunc = unregisterEmbeddingContextFunc {
            unregisterFunc(nativeId)
        }
        
        // Call native release function
        if let releaseFunc = releaseContextFunc {
            releaseFunc(nativeId)
        }
        
        contexts.removeValue(forKey: contextId)
        nativeContexts.removeValue(forKey: nativeId)
        contextIdToNative.removeValue(forKey: contextId)
        completion(.success(()))
    }
    
    func releaseAllContexts(completion: @escaping (LlamaResult<Void>) -> Void) {
        if releaseContextFunc == nil { loadFunctionPointers() }
        let pairs = Array(contextIdToNative)
        for (_, nativeId) in pairs {
            if let unregisterFunc = unregisterEmbeddingContextFunc {
                unregisterFunc(nativeId)
            }
            releaseContextFunc?(nativeId)
        }
        contexts.removeAll()
        nativeContexts.removeAll()
        contextIdToNative.removeAll()
        completion(.success(()))
    }
    
    // MARK: - Chat and completion
    
    func getFormattedChat(contextId: Int, messages: String, chatTemplate: String?, params: [String: Any]?, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        guard let nativeId = contextIdToNative[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        if getFormattedChatFunc == nil { loadFunctionPointers() }
        guard let fn = getFormattedChatFunc else {
            completion(.failure(.operationFailed("llama_get_formatted_chat not found")))
            return
        }
        var paramsJson = "{}"
        if let p = params, let d = try? JSONSerialization.data(withJSONObject: p), let s = String(data: d, encoding: .utf8) {
            paramsJson = s
        }
        let template = chatTemplate ?? ""
        let result: LlamaResult<[String: Any]> = messages.withCString { msgPtr in
            template.withCString { tplPtr in
                paramsJson.withCString { parPtr in
                    guard let c = fn(nativeId, msgPtr, tplPtr, parPtr), let dict = jsonObject(fromCString: c) else {
                        return .failure(.operationFailed("formatted chat failed"))
                    }
                    if let err = dict["error"] as? String {
                        return .failure(.operationFailed(err))
                    }
                    return .success(dict)
                }
            }
        }
        completion(result)
    }
    
    func completion(contextId: Int, params: [String: Any], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        guard let nativeId = contextIdToNative[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        if completionFunc == nil { loadFunctionPointers() }
        guard let fn = completionFunc else {
            completion(.failure(.operationFailed("llama_completion not found")))
            return
        }
        var paramsJson = "{}"
        do {
            let paramsData = try JSONSerialization.data(withJSONObject: params)
            paramsJson = String(data: paramsData, encoding: .utf8) ?? "{}"
        } catch {
            completion(.failure(.operationFailed("Failed to serialize params: \(error.localizedDescription)")))
            return
        }
        let result: LlamaResult<[String: Any]> = paramsJson.withCString { ptr in
            guard let c = fn(nativeId, ptr), let dict = jsonObject(fromCString: c) else {
                return .failure(.operationFailed("completion returned empty"))
            }
            if let err = dict["error"] as? String {
                return .failure(.operationFailed(err))
            }
            return .success(dict)
        }
        completion(result)
    }
    
    func stopCompletion(contextId: Int, completion: @escaping (LlamaResult<Void>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        guard let nativeId = contextIdToNative[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        if stopCompletionFunc == nil { loadFunctionPointers() }
        stopCompletionFunc?(nativeId)
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
                let jsSystem = JSTypes.coerceDictionaryToJSObject(systemMessage) ?? [:]
                allMessages.insert(jsSystem, at: 0)
            }
            
            // Convert to JSON string for getFormattedChat
            let allMessagesData = try JSONSerialization.data(withJSONObject: allMessages)
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
        let jsUser = JSTypes.coerceDictionaryToJSObject(userMessage) ?? [:]
        let messages: [JSObject] = [jsUser]
        
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
        
        // Call completion method directly
        self.completion(contextId: contextId, params: completionParams, completion: completion)
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
        guard let nativeId = contextIdToNative[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        if tokenizeFunc == nil { loadFunctionPointers() }
        guard let fn = tokenizeFunc else {
            completion(.failure(.operationFailed("llama_tokenize not found")))
            return
        }
        var pathsJson = "[]"
        if !imagePaths.isEmpty, let d = try? JSONSerialization.data(withJSONObject: imagePaths), let s = String(data: d, encoding: .utf8) {
            pathsJson = s
        }
        let result: LlamaResult<[String: Any]> = text.withCString { txtPtr in
            pathsJson.withCString { pj in
                guard let c = fn(nativeId, txtPtr, pj), let dict = jsonObject(fromCString: c) else {
                    return .failure(.operationFailed("tokenize failed"))
                }
                if let err = dict["error"] as? String {
                    return .failure(.operationFailed(err))
                }
                return .success(dict)
            }
        }
        completion(result)
    }
    
    func detokenize(contextId: Int, tokens: [Int], completion: @escaping (LlamaResult<String>) -> Void) {
        guard contexts[contextId] != nil else {
            completion(.failure(.contextNotFound))
            return
        }
        guard let nativeId = contextIdToNative[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        if detokenizeFunc == nil { loadFunctionPointers() }
        guard let fn = detokenizeFunc else {
            completion(.failure(.operationFailed("llama_detokenize not found")))
            return
        }
        guard let d = try? JSONSerialization.data(withJSONObject: tokens), let tokensJson = String(data: d, encoding: .utf8) else {
            completion(.failure(.invalidParameters))
            return
        }
        let s: LlamaResult<String> = tokensJson.withCString { ptr in
            guard let c = fn(nativeId, ptr) else {
                return .success("")
            }
            return .success(String(cString: c))
        }
        completion(s)
    }
    
    // MARK: - Embeddings and reranking
    
    func embedding(contextId: Int, text: String, params: [String: Any], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        guard let context = contexts[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        // Ensure function pointers are loaded
        if embeddingFunc == nil {
            loadFunctionPointers()
        }
        
        // Check if native embedding function is available
        guard let embeddingFunction = embeddingFunc else {
            // Native function not available - this means the C++ layer needs to implement it
            // Return error indicating native implementation is required
            print("Error: llama_embedding function not found in native library. Native C++ implementation required.")
            completion(.failure(.notImplemented))
            return
        }
        
        // Get embedding dimension from model
        guard let nEmbd = context.model?.nEmbd, nEmbd > 0 else {
            completion(.failure(.operationFailed("Model embedding dimension (n_embd) not available. Model may not be loaded or may not support embeddings.")))
            return
        }
        
        guard let nativeId = contextIdToNative[contextId] else {
            completion(.failure(.contextNotFound))
            return
        }
        
        var paramsJson = "{}"
        if !params.isEmpty {
            do {
                let paramsData = try JSONSerialization.data(withJSONObject: params)
                paramsJson = String(data: paramsData, encoding: .utf8) ?? "{}"
            } catch {
                print("Error serializing params: \(error)")
            }
        }
        
        let embOutcome: LlamaResult<[String: Any]> = text.withCString { txtPtr in
            paramsJson.withCString { parPtr in
                guard let embeddingPtr = embeddingFunction(nativeId, txtPtr, parPtr) else {
                    return .failure(.operationFailed("Native embedding returned null."))
                }
                let embeddingArray = Array(UnsafeBufferPointer(start: embeddingPtr, count: nEmbd))
                let embeddingDoubles = embeddingArray.map { Double($0) }
                let embeddingResult: [String: Any] = [
                    "embedding": embeddingDoubles,
                    "n_embd": nEmbd
                ]
                return .success(embeddingResult)
            }
        }
        completion(embOutcome)
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
            "grammar": NSNull()
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
    
    // MARK: - Model download and management
    
    func downloadModel(url: String, filename: String, completion: @escaping (LlamaResult<String>) -> Void) {
        // Get the documents directory
        let fileManager = FileManager.default
        guard let documentsDir = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            completion(.failure(.operationFailed("Could not access documents directory")))
            return
        }
        
        let localPath = documentsDir.appendingPathComponent(filename).path
        
        // Check if file already exists
        if fileManager.fileExists(atPath: localPath) {
            completion(.success(localPath))
            return
        }
        
        // Download the file asynchronously
        DispatchQueue.global(qos: .background).async {
            guard let downloadURL = URL(string: url) else {
                DispatchQueue.main.async {
                    completion(.failure(.operationFailed("Invalid URL")))
                }
                return
            }
            
            do {
                let data = try Data(contentsOf: downloadURL)
                try data.write(to: URL(fileURLWithPath: localPath))
                
                DispatchQueue.main.async {
                    completion(.success(localPath))
                }
            } catch {
                DispatchQueue.main.async {
                    completion(.failure(.operationFailed("Download failed: \(error.localizedDescription)")))
                }
            }
        }
    }
    
    func getDownloadProgress(url: String, completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        // For now, return a placeholder progress
        // In a real implementation, this would track download progress
        let progress: [String: Any] = [
            "url": url,
            "downloaded": 0,
            "total": 0,
            "percentage": 0.0
        ]
        completion(.success(progress))
    }
    
    func cancelDownload(url: String, completion: @escaping (LlamaResult<Bool>) -> Void) {
        // For now, return success
        // In a real implementation, this would cancel the ongoing download
        completion(.success(true))
    }
    
    func getAvailableModels(completion: @escaping (LlamaResult<[[String: Any]]>) -> Void) {
        let fileManager = FileManager.default
        var models: [[String: Any]] = []
        
        // Search common model directories
        let searchPaths = [
            fileManager.urls(for: .documentDirectory, in: .userDomainMask).first,
            fileManager.urls(for: .downloadsDirectory, in: .userDomainMask).first
        ].compactMap { $0 }
        
        for searchPath in searchPaths {
            do {
                let files = try fileManager.contentsOfDirectory(at: searchPath, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])
                
                for file in files {
                    let pathExtension = file.pathExtension.lowercased()
                    // Check for common model file extensions
                    if pathExtension == "gguf" || pathExtension == "ggml" || pathExtension == "bin" {
                        let attributes = try fileManager.attributesOfItem(atPath: file.path)
                        let fileSize = attributes[.size] as? Int64 ?? 0
                        
                        let model: [String: Any] = [
                            "id": file.lastPathComponent,
                            "name": file.lastPathComponent,
                            "path": file.path,
                            "size": fileSize,
                            "sizeMB": Double(fileSize) / (1024 * 1024),
                            "status": "available"
                        ]
                        models.append(model)
                    }
                }
            } catch {
                // Continue searching other paths
                continue
            }
        }
        
        completion(.success(models))
    }

    // MARK: - Native in-process HTTP server (127.0.0.1 — use App Transport Security allowances for localhost in the host app)

    func startNativeLlamaServer(modelPath: String, host: String?, port: Int, params: [String: Any], completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        if capServerStartFunc == nil { loadFunctionPointers() }
        guard let start = capServerStartFunc else {
            completion(.failure(.operationFailed("cap_llama_server_start not available")))
            return
        }
        var paramsJson = "{}"
        do {
            let data = try JSONSerialization.data(withJSONObject: params)
            paramsJson = String(data: data, encoding: .utf8) ?? "{}"
        } catch {
            completion(.failure(.operationFailed("params JSON: \(error.localizedDescription)")))
            return
        }
        let h = (host != nil && !host!.isEmpty) ? host! : "127.0.0.1"
        let rc = modelPath.withCString { mp in
            h.withCString { hp in
                paramsJson.withCString { pj in
                    start(mp, hp, Int32(port), pj)
                }
            }
        }
        if rc != 0 {
            completion(.success(["running": true]))
        } else {
            completion(.failure(.operationFailed("startNativeLlamaServer failed")))
        }
    }

    func stopNativeLlamaServer(completion: @escaping (LlamaResult<Void>) -> Void) {
        if capServerStopFunc == nil { loadFunctionPointers() }
        guard let stop = capServerStopFunc else {
            completion(.failure(.operationFailed("cap_llama_server_stop not available")))
            return
        }
        stop()
        completion(.success(()))
    }

    func isNativeLlamaServerRunning(completion: @escaping (LlamaResult<[String: Any]>) -> Void) {
        if capServerIsRunningFunc == nil { loadFunctionPointers() }
        guard let fn = capServerIsRunningFunc else {
            completion(.failure(.operationFailed("cap_llama_server_is_running not available")))
            return
        }
        let running = fn() != 0
        completion(.success(["running": running]))
    }
    
    // MARK: - Grammar utilities
    
    func convertJsonSchemaToGrammar(schema: String, completion: @escaping (LlamaResult<String>) -> Void) {
        if grammarFunc == nil { loadFunctionPointers() }
        guard let fn = grammarFunc else {
            completion(.success(schema))
            return
        }
        let s: LlamaResult<String> = schema.withCString { ptr in
            guard let c = fn(ptr) else {
                return .success("")
            }
            let g = String(cString: c)
            return g.isEmpty ? .success(schema) : .success(g)
        }
        completion(s)
    }
}
