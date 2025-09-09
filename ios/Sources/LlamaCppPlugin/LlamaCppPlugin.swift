import Foundation
import Capacitor

/**
 * Please read the Capacitor iOS Plugin Development Guide
 * here: https://capacitorjs.com/docs/plugins/ios
 */
@objc(LlamaCppPlugin)
public class LlamaCppPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LlamaCppPlugin"
    public let jsName = "LlamaCpp"
    public let pluginMethods: [CAPPluginMethod] = [
        // Core initialization and management
        CAPPluginMethod(name: "toggleNativeLog", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setContextLimit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "modelInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "initContext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseContext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseAllContexts", returnType: CAPPluginReturnPromise),
        
        // Chat and completion
        CAPPluginMethod(name: "getFormattedChat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "completion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopCompletion", returnType: CAPPluginReturnPromise),
        
        // Session management
        CAPPluginMethod(name: "loadSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSession", returnType: CAPPluginReturnPromise),
        
        // Tokenization
        CAPPluginMethod(name: "tokenize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detokenize", returnType: CAPPluginReturnPromise),
        
        // Embeddings and reranking
        CAPPluginMethod(name: "embedding", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rerank", returnType: CAPPluginReturnPromise),
        
        // Benchmarking
        CAPPluginMethod(name: "bench", returnType: CAPPluginReturnPromise),
        
        // LoRA adapters
        CAPPluginMethod(name: "applyLoraAdapters", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeLoraAdapters", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLoadedLoraAdapters", returnType: CAPPluginReturnPromise),
        
        // Multimodal methods
        CAPPluginMethod(name: "initMultimodal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isMultimodalEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMultimodalSupport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseMultimodal", returnType: CAPPluginReturnPromise),
        
        // TTS methods
        CAPPluginMethod(name: "initVocoder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isVocoderEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getFormattedAudioCompletion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAudioCompletionGuideTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "decodeAudioTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "releaseVocoder", returnType: CAPPluginReturnPromise),
        
        // Model download and management
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDownloadProgress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAvailableModels", returnType: CAPPluginReturnPromise),
        
        // Grammar utilities
        CAPPluginMethod(name: "convertJsonSchemaToGrammar", returnType: CAPPluginReturnPromise),
        
        // Events
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise)
    ]
    
    private let implementation = LlamaCpp()

    // MARK: - Core initialization and management
    
    @objc func toggleNativeLog(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        implementation.toggleNativeLog(enabled: enabled) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func setContextLimit(_ call: CAPPluginCall) {
        let limit = call.getInt("limit") ?? 0
        implementation.setContextLimit(limit: limit) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func modelInfo(_ call: CAPPluginCall) {
        let path = call.getString("path") ?? ""
        let skip = call.getArray("skip", String.self) ?? []
        
        implementation.modelInfo(path: path, skip: skip) { result in
            switch result {
            case .success(let modelInfo):
                call.resolve(modelInfo)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func initContext(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let params = call.getObject("params") ?? [:]
        
        implementation.initContext(contextId: contextId, params: params) { result in
            switch result {
            case .success(let context):
                call.resolve(context)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func releaseContext(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.releaseContext(contextId: contextId) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func releaseAllContexts(_ call: CAPPluginCall) {
        implementation.releaseAllContexts { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Chat and completion
    
    @objc func getFormattedChat(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let messages = call.getString("messages") ?? ""
        let chatTemplate = call.getString("chatTemplate")
        let params = call.getObject("params")
        
        implementation.getFormattedChat(
            contextId: contextId,
            messages: messages,
            chatTemplate: chatTemplate,
            params: params
        ) { result in
            switch result {
            case .success(let formattedChat):
                call.resolve(formattedChat)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func completion(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let params = call.getObject("params") ?? [:]
        
        implementation.completion(contextId: contextId, params: params) { result in
            switch result {
            case .success(let completionResult):
                call.resolve(completionResult)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func stopCompletion(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.stopCompletion(contextId: contextId) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Session management
    
    @objc func loadSession(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let filepath = call.getString("filepath") ?? ""
        
        implementation.loadSession(contextId: contextId, filepath: filepath) { result in
            switch result {
            case .success(let sessionResult):
                call.resolve(sessionResult)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func saveSession(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let filepath = call.getString("filepath") ?? ""
        let size = call.getInt("size") ?? -1
        
        implementation.saveSession(contextId: contextId, filepath: filepath, size: size) { result in
            switch result {
            case .success(let tokensSaved):
                call.resolve(["tokensSaved": tokensSaved])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Tokenization
    
    @objc func tokenize(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let text = call.getString("text") ?? ""
        let imagePaths = call.getArray("imagePaths", String.self) ?? []
        
        implementation.tokenize(contextId: contextId, text: text, imagePaths: imagePaths) { result in
            switch result {
            case .success(let tokenizeResult):
                call.resolve(tokenizeResult)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func detokenize(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let tokens = call.getArray("tokens", Int.self) ?? []
        
        implementation.detokenize(contextId: contextId, tokens: tokens) { result in
            switch result {
            case .success(let text):
                call.resolve(["text": text])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Embeddings and reranking
    
    @objc func embedding(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let text = call.getString("text") ?? ""
        let params = call.getObject("params") ?? [:]
        
        implementation.embedding(contextId: contextId, text: text, params: params) { result in
            switch result {
            case .success(let embeddingResult):
                call.resolve(embeddingResult)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func rerank(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let query = call.getString("query") ?? ""
        let documents = call.getArray("documents", String.self) ?? []
        let params = call.getObject("params")
        
        implementation.rerank(contextId: contextId, query: query, documents: documents, params: params) { result in
            switch result {
            case .success(let rerankResults):
                call.resolve(["results": rerankResults])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Benchmarking
    
    @objc func bench(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let pp = call.getInt("pp") ?? 0
        let tg = call.getInt("tg") ?? 0
        let pl = call.getInt("pl") ?? 0
        let nr = call.getInt("nr") ?? 0
        
        implementation.bench(contextId: contextId, pp: pp, tg: tg, pl: pl, nr: nr) { result in
            switch result {
            case .success(let benchResult):
                call.resolve(["result": benchResult])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - LoRA adapters
    
    @objc func applyLoraAdapters(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let loraAdapters = call.getArray("loraAdapters", [String: Any].self) ?? []
        
        implementation.applyLoraAdapters(contextId: contextId, loraAdapters: loraAdapters) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func removeLoraAdapters(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.removeLoraAdapters(contextId: contextId) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func getLoadedLoraAdapters(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.getLoadedLoraAdapters(contextId: contextId) { result in
            switch result {
            case .success(let adapters):
                call.resolve(["adapters": adapters])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Multimodal methods
    
    @objc func initMultimodal(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let params = call.getObject("params") ?? [:]
        let path = params["path"] as? String ?? ""
        let useGpu = params["use_gpu"] as? Bool ?? true
        
        implementation.initMultimodal(contextId: contextId, path: path, useGpu: useGpu) { result in
            switch result {
            case .success(let success):
                call.resolve(["success": success])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func isMultimodalEnabled(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.isMultimodalEnabled(contextId: contextId) { result in
            switch result {
            case .success(let enabled):
                call.resolve(["enabled": enabled])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func getMultimodalSupport(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.getMultimodalSupport(contextId: contextId) { result in
            switch result {
            case .success(let support):
                call.resolve(support)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func releaseMultimodal(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.releaseMultimodal(contextId: contextId) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - TTS methods
    
    @objc func initVocoder(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let params = call.getObject("params") ?? [:]
        let path = params["path"] as? String ?? ""
        let nBatch = params["n_batch"] as? Int
        
        implementation.initVocoder(contextId: contextId, path: path, nBatch: nBatch) { result in
            switch result {
            case .success(let success):
                call.resolve(["success": success])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func isVocoderEnabled(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.isVocoderEnabled(contextId: contextId) { result in
            switch result {
            case .success(let enabled):
                call.resolve(["enabled": enabled])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func getFormattedAudioCompletion(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let speakerJsonStr = call.getString("speakerJsonStr") ?? ""
        let textToSpeak = call.getString("textToSpeak") ?? ""
        
        implementation.getFormattedAudioCompletion(
            contextId: contextId,
            speakerJsonStr: speakerJsonStr,
            textToSpeak: textToSpeak
        ) { result in
            switch result {
            case .success(let audioCompletion):
                call.resolve(audioCompletion)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func getAudioCompletionGuideTokens(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let textToSpeak = call.getString("textToSpeak") ?? ""
        
        implementation.getAudioCompletionGuideTokens(contextId: contextId, textToSpeak: textToSpeak) { result in
            switch result {
            case .success(let tokens):
                call.resolve(["tokens": tokens])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func decodeAudioTokens(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        let tokens = call.getArray("tokens", Int.self) ?? []
        
        implementation.decodeAudioTokens(contextId: contextId, tokens: tokens) { result in
            switch result {
            case .success(let decodedTokens):
                call.resolve(["decodedTokens": decodedTokens])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func releaseVocoder(_ call: CAPPluginCall) {
        let contextId = call.getInt("contextId") ?? 0
        
        implementation.releaseVocoder(contextId: contextId) { result in
            switch result {
            case .success:
                call.resolve()
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Events
    
    @objc func addListener(_ call: CAPPluginCall) {
        let eventName = call.getString("eventName") ?? ""
        // Note: In Capacitor, event listeners are typically handled differently
        // This is a placeholder for the event system
        call.resolve()
    }
    
    @objc func removeAllListeners(_ call: CAPPluginCall) {
        let eventName = call.getString("eventName") ?? ""
        // Note: In Capacitor, event listeners are typically handled differently
        // This is a placeholder for the event system
        call.resolve()
    }
    
    // MARK: - Model download and management
    
    @objc func downloadModel(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let filename = call.getString("filename") ?? ""
        
        implementation.downloadModel(url: url, filename: filename) { result in
            switch result {
            case .success(let path):
                call.resolve(["path": path])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func getDownloadProgress(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        
        implementation.getDownloadProgress(url: url) { result in
            switch result {
            case .success(let progress):
                call.resolve(progress)
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func cancelDownload(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        
        implementation.cancelDownload(url: url) { result in
            switch result {
            case .success(let cancelled):
                call.resolve(["cancelled": cancelled])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    @objc func getAvailableModels(_ call: CAPPluginCall) {
        implementation.getAvailableModels { result in
            switch result {
            case .success(let models):
                call.resolve(["models": models])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
    
    // MARK: - Grammar utilities
    
    @objc func convertJsonSchemaToGrammar(_ call: CAPPluginCall) {
        let schema = call.getString("schema") ?? ""
        
        implementation.convertJsonSchemaToGrammar(schema: schema) { result in
            switch result {
            case .success(let grammar):
                call.resolve(["grammar": grammar])
            case .failure(let error):
                call.reject(error.localizedDescription)
            }
        }
    }
}
