use serde_json::Value;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_float};

unsafe extern "C" {
    fn llama_init_context(model_path: *const c_char, params_json: *const c_char) -> i64;
    fn llama_release_context(context_id: i64);
    fn llama_get_context_model_json(context_id: i64) -> *const c_char;
    fn llama_completion(context_id: i64, params_json: *const c_char) -> *const c_char;
    fn llama_embedding(context_id: i64, text: *const c_char, params_json: *const c_char) -> *mut c_float;
}

fn cstring(input: &str) -> Result<CString, String> {
    CString::new(input).map_err(|_| "Input contains interior NUL byte".to_string())
}

fn cstr_to_string(ptr: *const c_char) -> Result<String, String> {
    if ptr.is_null() {
        return Err("Null pointer returned from llama bridge".to_string());
    }
    let s = unsafe { CStr::from_ptr(ptr) };
    Ok(s.to_string_lossy().to_string())
}

pub fn init_context(model_path: &str, params_json: &str) -> Result<i64, String> {
    let model_path_c = cstring(model_path)?;
    let params_c = cstring(params_json)?;
    let context_id = unsafe { llama_init_context(model_path_c.as_ptr(), params_c.as_ptr()) };
    if context_id <= 0 {
        return Err("llama_init_context failed".to_string());
    }
    Ok(context_id)
}

pub fn release_context(context_id: i64) {
    unsafe { llama_release_context(context_id) };
}

pub fn completion(context_id: i64, params_json: &str) -> Result<String, String> {
    let params_c = cstring(params_json)?;
    let raw = unsafe { llama_completion(context_id, params_c.as_ptr()) };
    let text = cstr_to_string(raw)?;

    let parsed: Result<Value, _> = serde_json::from_str(&text);
    if let Ok(value) = parsed {
        if let Some(error) = value.get("error").and_then(|e| e.as_str()) {
            return Err(error.to_string());
        }
    }
    Ok(text)
}

pub fn get_model_json(context_id: i64) -> Result<String, String> {
    let raw = unsafe { llama_get_context_model_json(context_id) };
    cstr_to_string(raw)
}

pub fn embedding(context_id: i64, text: &str, params_json: &str) -> Result<Vec<f32>, String> {
    let model_json = get_model_json(context_id)?;
    let model_meta: Value =
        serde_json::from_str(&model_json).map_err(|e| format!("Invalid model metadata JSON: {e}"))?;
    let n_embd = model_meta
        .get("nEmbd")
        .and_then(|v| v.as_i64())
        .and_then(|v| usize::try_from(v).ok())
        .ok_or_else(|| "Unable to determine embedding size (nEmbd)".to_string())?;

    let text_c = cstring(text)?;
    let params_c = cstring(params_json)?;
    let ptr = unsafe { llama_embedding(context_id, text_c.as_ptr(), params_c.as_ptr()) };
    if ptr.is_null() {
        return Err("llama_embedding returned null".to_string());
    }

    let slice = unsafe { std::slice::from_raw_parts(ptr, n_embd) };
    Ok(slice.to_vec())
}

