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
import org.json.JSONObject;
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
        String chatTemplate = call.getString("chatTemplate", "");
        JSObject params = call.getObject("params", new JSObject());

        implementation.getFormattedChat(contextId, messages, chatTemplate, params, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
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
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
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
        String filepath = call.getString("filepath", "");

        implementation.loadSession(contextId, filepath, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void saveSession(PluginCall call) {
        int contextId = call.getInt("contextId", 0);
        String filepath = call.getString("filepath", "");
        int size = call.getInt("size", -1);

        implementation.saveSession(contextId, filepath, size, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("tokens_saved", result.getData());
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
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
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
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
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
        JSObject params = call.getObject("params", new JSObject());

        implementation.rerank(contextId, query, documents, params, result -> {
            if (result.isSuccess()) {
                List<Map<String, Object>> data = result.getData();
                JSArray jsArray = convertListToJSArray(data);
                JSObject ret = new JSObject();
                ret.put("results", jsArray);
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
        int pp = call.getInt("pp", 128);
        int tg = call.getInt("tg", 128);
        int pl = call.getInt("pl", 1);
        int nr = call.getInt("nr", 1);

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
        List<Map<String, Object>> loraAdapters = new ArrayList<>();
        
        if (loraAdaptersArray != null) {
            for (int i = 0; i < loraAdaptersArray.length(); i++) {
                try {
                    JSONObject adapter = loraAdaptersArray.getJSONObject(i);
                    Map<String, Object> adapterMap = new HashMap<>();
                    adapterMap.put("path", adapter.optString("path", ""));
                    adapterMap.put("scaled", adapter.optDouble("scaled", 1.0));
                    loraAdapters.add(adapterMap);
                } catch (JSONException e) {
                    Log.e(TAG, "Error parsing LoRA adapter: " + e.getMessage());
                }
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
                List<Map<String, Object>> data = result.getData();
                JSArray jsArray = convertListToJSArray(data);
                JSObject ret = new JSObject();
                ret.put("adapters", jsArray);
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
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
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
        Integer nBatch = params.getInteger("n_batch", 512);

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
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
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
                List<Integer> data = result.getData();
                JSArray jsArray = new JSArray();
                for (Integer token : data) {
                    jsArray.put(token);
                }
                JSObject ret = new JSObject();
                ret.put("tokens", jsArray);
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
                List<Integer> data = result.getData();
                JSArray jsArray = new JSArray();
                for (Integer token : data) {
                    jsArray.put(token);
                }
                JSObject ret = new JSObject();
                ret.put("audioData", jsArray);
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

    // MARK: - Model download and management

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String url = call.getString("url", "");
        String filename = call.getString("filename", "");

        implementation.downloadModel(url, filename, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("localPath", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getDownloadProgress(PluginCall call) {
        String url = call.getString("url", "");

        implementation.getDownloadProgress(url, result -> {
            if (result.isSuccess()) {
                Map<String, Object> data = result.getData();
                JSObject jsResult = convertMapToJSObject(data);
                call.resolve(jsResult);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String url = call.getString("url", "");

        implementation.cancelDownload(url, result -> {
            if (result.isSuccess()) {
                JSObject ret = new JSObject();
                ret.put("cancelled", result.getData());
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    @PluginMethod
    public void getAvailableModels(PluginCall call) {
        implementation.getAvailableModels(result -> {
            if (result.isSuccess()) {
                List<Map<String, Object>> data = result.getData();
                JSArray jsArray = convertListToJSArray(data);
                JSObject ret = new JSObject();
                ret.put("models", jsArray);
                call.resolve(ret);
            } else {
                call.reject(result.getError().getMessage());
            }
        });
    }

    // MARK: - Utility Methods

    /**
     * Convert a Map to JSObject with proper handling of nested structures
     */
    private JSObject convertMapToJSObject(Map<String, Object> map) {
        JSObject jsObject = new JSObject();
        
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            
            if (value instanceof List<?>) {
                List<?> list = (List<?>) value;
                JSArray jsArray = new JSArray();
                for (Object item : list) {
                    if (item instanceof Map<?, ?>) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> itemMap = (Map<String, Object>) item;
                        jsArray.put(convertMapToJSObject(itemMap));
                    } else {
                        jsArray.put(item);
                    }
                }
                jsObject.put(key, jsArray);
            } else if (value instanceof Map<?, ?>) {
                @SuppressWarnings("unchecked")
                Map<String, Object> nestedMap = (Map<String, Object>) value;
                jsObject.put(key, convertMapToJSObject(nestedMap));
            } else {
                jsObject.put(key, value);
            }
        }
        
        return jsObject;
    }

    /**
     * Convert a List of Maps to JSArray
     */
    private JSArray convertListToJSArray(List<Map<String, Object>> list) {
        JSArray jsArray = new JSArray();
        
        for (Map<String, Object> item : list) {
            jsArray.put(convertMapToJSObject(item));
        }
        
        return jsArray;
    }
}
