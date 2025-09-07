package ai.annadata.plugin.capacitor;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;
import org.json.JSONException;
import android.content.Context;
import android.os.Environment;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;

@CapacitorPlugin(name = "LlamaCpp")
public class LlamaCppPlugin extends Plugin {
    private static final String TAG = "LlamaCppPlugin";

    private LlamaCpp implementation;

    @Override
    public void load() {
        super.load();
        // Initialize implementation with context
        implementation = new LlamaCpp(getContext());
        Log.i(TAG, "LlamaCppPlugin loaded successfully");
    }

    // MARK: - Core initialization and management

    @PluginMethod
    public void toggleNativeLog(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        implementation.toggleNativeLog(enabled, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void setContextLimit(PluginCall call) {
        int limit = call.getInt("limit", 10);
        implementation.setContextLimit(limit, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void modelInfo(PluginCall call) {
        String path = call.getString("path", "");
        JSArray skipArray = call.getArray("skip");
        String[] skip = new String[0];
        if (skipArray != null) {
            skip = new String[skipArray.length()];
            for (int i = 0; i < skipArray.length(); i++) {
                try {
                    skip[i] = skipArray.getString(i);
                } catch (JSONException e) {
                    skip[i] = "";
                }
            }
        }

        implementation.modelInfo(path, skip, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void initContext(PluginCall call) {
        Log.i(TAG, "initContext called with contextId: " + call.getInt("contextId", 0));
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());

        implementation.initContext(contextId, params, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseContext(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.releaseContext(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseAllContexts(PluginCall call) {
        implementation.releaseAllContexts(result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Chat and completion

    @PluginMethod
    public void getFormattedChat(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String messages = call.getString("messages", "");
        String chatTemplate = call.getString("chatTemplate");
        JSObject params = call.getObject("params");

        implementation.getFormattedChat(contextId, messages, chatTemplate, params, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void completion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());

        implementation.completion(contextId, params, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void stopCompletion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.stopCompletion(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Session management

    @PluginMethod
    public void loadSession(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String path = call.getString("path", "");

        implementation.loadSession(contextId, path, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void saveSession(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String path = call.getString("path", "");
        int size = call.getInt("size", -1);

        implementation.saveSession(contextId, path, size, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("tokensSaved", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Tokenization

    @PluginMethod
    public void tokenize(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String text = call.getString("text", "");
        JSArray imagePathsArray = call.getArray("imagePaths");
        String[] imagePaths = new String[0];
        if (imagePathsArray != null) {
            imagePaths = new String[imagePathsArray.length()];
            for (int i = 0; i < imagePathsArray.length(); i++) {
                try {
                    imagePaths[i] = imagePathsArray.getString(i);
                } catch (JSONException e) {
                    imagePaths[i] = "";
                }
            }
        }

        implementation.tokenize(contextId, text, imagePaths, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    String key = entry.getKey();
                    Object value = entry.getValue();
                    
                    // Convert Java arrays to JSArray
                    if (value instanceof Integer[]) {
                        Integer[] intArray = (Integer[]) value;
                        JSArray jsArray = new JSArray();
                        for (Integer item : intArray) {
                            jsArray.put(item);
                        }
                        jsResult.put(key, jsArray);
                    } else {
                        jsResult.put(key, value);
                    }
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void detokenize(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSArray tokensArray = call.getArray("tokens");
        Integer[] tokens = new Integer[0];
        if (tokensArray != null) {
            tokens = new Integer[tokensArray.length()];
            for (int i = 0; i < tokensArray.length(); i++) {
                try {
                    tokens[i] = tokensArray.getInt(i);
                } catch (JSONException e) {
                    tokens[i] = 0;
                }
            }
        }

        implementation.detokenize(contextId, tokens, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("text", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Embeddings and reranking

    @PluginMethod
    public void embedding(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String text = call.getString("text", "");
        JSObject params = call.getObject("params", new JSObject());

        implementation.embedding(contextId, text, params, result -> {
            if (result.isSuccess()) {
                JSObject jsResult = new JSObject();
                Map<String, Object> data = result.getData();
                for (Map.Entry<String, Object> entry : data.entrySet()) {
                    jsResult.put(entry.getKey(), entry.getValue());
                }
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void rerank(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String query = call.getString("query", "");
        JSArray documentsArray = call.getArray("documents");
        String[] documents = new String[0];
        if (documentsArray != null) {
            documents = new String[documentsArray.length()];
            for (int i = 0; i < documentsArray.length(); i++) {
                try {
                    documents[i] = documentsArray.getString(i);
                } catch (JSONException e) {
                    documents[i] = "";
                }
            }
        }
        JSObject params = call.getObject("params");

        implementation.rerank(contextId, query, documents, params, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("results", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Benchmarking

    @PluginMethod
    public void bench(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        int pp = call.getInt("pp", 0);
        int tg = call.getInt("tg", 0);
        int pl = call.getInt("pl", 0);
        int nr = call.getInt("nr", 0);

        implementation.bench(contextId, pp, tg, pl, nr, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("result", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - LoRA adapters

    @PluginMethod
    public void applyLoraAdapters(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSArray loraAdaptersArray = call.getArray("loraAdapters");
        JSObject[] loraAdapters = new JSObject[0];
        if (loraAdaptersArray != null) {
            loraAdapters = new JSObject[loraAdaptersArray.length()];
            for (int i = 0; i < loraAdaptersArray.length(); i++) {
                // For now, create empty JSObjects since the exact method is unclear
                loraAdapters[i] = new JSObject();
            }
        }

        implementation.applyLoraAdapters(contextId, loraAdapters, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void removeLoraAdapters(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.removeLoraAdapters(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getLoadedLoraAdapters(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.getLoadedLoraAdapters(contextId, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("adapters", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Multimodal methods

    @PluginMethod
    public void initMultimodal(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());
        String path = params.getString("path", "");
        boolean useGpu = params.getBoolean("use_gpu", true);

        implementation.initMultimodal(contextId, path, useGpu, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("success", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void isMultimodalEnabled(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.isMultimodalEnabled(contextId, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("enabled", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getMultimodalSupport(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.getMultimodalSupport(contextId, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("support", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseMultimodal(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.releaseMultimodal(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - TTS methods

    @PluginMethod
    public void initVocoder(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSObject params = call.getObject("params", new JSObject());
        String path = params.getString("path", "");
        Integer nBatch = params.getInteger("n_batch");

        implementation.initVocoder(contextId, path, nBatch, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("success", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void isVocoderEnabled(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.isVocoderEnabled(contextId, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("enabled", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getFormattedAudioCompletion(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String speakerJsonStr = call.getString("speakerJsonStr", "");
        String textToSpeak = call.getString("textToSpeak", "");

        implementation.getFormattedAudioCompletion(contextId, speakerJsonStr, textToSpeak, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("completion", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getAudioCompletionGuideTokens(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String textToSpeak = call.getString("textToSpeak", "");

        implementation.getAudioCompletionGuideTokens(contextId, textToSpeak, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("tokens", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void decodeAudioTokens(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        JSArray tokensArray = call.getArray("tokens");
        Integer[] tokens = new Integer[0];
        if (tokensArray != null) {
            tokens = new Integer[tokensArray.length()];
            for (int i = 0; i < tokensArray.length(); i++) {
                try {
                    tokens[i] = tokensArray.getInt(i);
                } catch (JSONException e) {
                    tokens[i] = 0;
                }
            }
        }

        implementation.decodeAudioTokens(contextId, tokens, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("decodedTokens", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void releaseVocoder(PluginCall call) {
        int contextId = call.getInt("contextId", 0);

        implementation.releaseVocoder(contextId, result -> {
            if (result.isSuccess()) {
                call.resolve();
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Events

    @PluginMethod
    public void addListener(PluginCall call) {
        String eventName = call.getString("eventName", "");
        // Note: In Capacitor, event listeners are typically handled differently
        // This is a placeholder for the event system
        call.resolve();
    }

    @PluginMethod
    public void removeAllListeners(PluginCall call) {
        String eventName = call.getString("eventName", "");
        // Note: In Capacitor, event listeners are typically handled differently
        // This is a placeholder for the event system
        call.resolve();
    }
}
