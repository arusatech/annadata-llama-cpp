use std::env;
use std::path::{Path, PathBuf};

fn workspace_cpp_dir(crate_dir: &Path) -> PathBuf {
    crate_dir
        .parent()
        .map(|p| p.join("cpp"))
        .unwrap_or_else(|| crate_dir.join("cpp"))
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rustc-check-cfg=cfg(llama_embed_cpp)");
    println!("cargo:rerun-if-env-changed=LLAMA_WASM_EMBED_CPP");
    println!("cargo:rerun-if-env-changed=LLAMA_WASM_SYSROOT");

    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string()));
    let cpp_dir = workspace_cpp_dir(&crate_dir);
    let target = env::var("TARGET").unwrap_or_default();

    // Embed llama.cpp C/C++ sources for wasm builds.
    let embed_cpp = env::var("LLAMA_WASM_EMBED_CPP")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or_else(|_| target.contains("emscripten"));

    if !embed_cpp {
        return;
    }
    println!("cargo:rustc-cfg=llama_embed_cpp");

    if !cpp_dir.exists() {
        println!(
            "cargo:warning=cpp directory not found at {}; skipping embedded llama.cpp compilation",
            cpp_dir.display()
        );
        return;
    }

    let probe_file = cpp_dir.join("llama.cpp");
    if !probe_file.exists() {
        println!(
            "cargo:warning=llama.cpp not found at {}; skipping embedded llama.cpp compilation",
            probe_file.display()
        );
        return;
    }

    // Keep source list aligned with native builds while excluding platform-specific units
    // (e.g. ggml-metal, Android/iOS-specific wrappers).
    let sources: &[&str] = &[
        "ggml.c",
        "ggml-alloc.c",
        "ggml-backend.cpp",
        "ggml-backend-reg.cpp",
        "ggml-cpu/ggml-cpu.c",
        "ggml-cpu/ggml-cpu.cpp",
        "ggml-cpu/quants.c",
        "ggml-cpu/traits.cpp",
        "ggml-cpu/repack.cpp",
        "ggml-cpu/unary-ops.cpp",
        "ggml-cpu/binary-ops.cpp",
        "ggml-cpu/vec.cpp",
        "ggml-cpu/ops.cpp",
        "ggml-opt.cpp",
        "ggml-threading.cpp",
        "ggml-quants.c",
        "llama-impl.cpp",
        "llama-grammar.cpp",
        "llama-sampling.cpp",
        "llama-vocab.cpp",
        "llama-adapter.cpp",
        "llama-chat.cpp",
        "llama-context.cpp",
        "llama-arch.cpp",
        "llama-batch.cpp",
        "llama-cparams.cpp",
        "llama-hparams.cpp",
        "llama.cpp",
        "llama-model.cpp",
        "llama-model-loader.cpp",
        "llama-model-saver.cpp",
        "llama-kv-cache.cpp",
        "llama-kv-cache-iswa.cpp",
        "llama-memory-hybrid.cpp",
        "llama-memory-recurrent.cpp",
        "llama-memory.cpp",
        "llama-mmap.cpp",
        "llama-io.cpp",
        "llama-graph.cpp",
        "chat.cpp",
        "chat-parser.cpp",
        "json-partial.cpp",
        "json-schema-to-grammar.cpp",
        "sampling.cpp",
        "unicode.cpp",
        "cap-llama.cpp",
        "cap-completion.cpp",
        "cap-embedding.cpp",
        "cap-ios-bridge.cpp",
    ];

    let mut c_sources: Vec<PathBuf> = Vec::new();
    let mut cxx_sources: Vec<PathBuf> = Vec::new();
    for rel in sources {
        let path = cpp_dir.join(rel);
        if path.exists() {
            println!("cargo:rerun-if-changed={}", path.display());
            match path.extension().and_then(|e| e.to_str()) {
                Some("c") => c_sources.push(path),
                _ => cxx_sources.push(path),
            }
        } else {
            println!(
                "cargo:warning=Skipping missing C/C++ source during wasm embed: {}",
                cpp_dir.join(rel).display()
            );
        }
    }

    let mut c_build = cc::Build::new();
    c_build
        .cpp(false)
        .flag("-fPIC")
        .include(&cpp_dir)
        .include(cpp_dir.join("ggml-cpu"))
        .define("GGML_USE_CPU", None)
        .define("GGML_USE_K_QUANTS", None)
        .define("GGML_USE_WASM", None)
        .define("CAPLLAMA_BUILD_WASM", None)
        .warnings(false);

    let mut cxx_build = cc::Build::new();
    cxx_build
        .cpp(true)
        .cpp_link_stdlib(None)
        .std("c++17")
        .flag("-fPIC")
        .include(&cpp_dir)
        .include(cpp_dir.join("ggml-cpu"))
        .define("GGML_USE_CPU", None)
        .define("GGML_USE_K_QUANTS", None)
        .define("GGML_USE_WASM", None)
        .define("CAPLLAMA_BUILD_WASM", None)
        .warnings(false);

    if let Ok(sysroot) = env::var("LLAMA_WASM_SYSROOT") {
        let sysroot_path = PathBuf::from(&sysroot);
        let include = sysroot_path.join("include");
        let cxx_include = include.join("c++").join("v1");
        let em_lib = sysroot_path.join("lib").join("wasm32-emscripten");
        let target_is_emscripten = target.contains("emscripten");
        if include.exists() && !target_is_emscripten {
            c_build.flag(&format!("--sysroot={}", sysroot));
            cxx_build.flag(&format!("--sysroot={}", sysroot));
            c_build.include(&include);
            cxx_build.include(&include);
        }
        if cxx_include.exists() && !target_is_emscripten {
            cxx_build.include(&cxx_include);
        }
        if em_lib.exists() && !target_is_emscripten {
            println!("cargo:rustc-link-search=native={}", em_lib.display());
            println!("cargo:rustc-link-lib=static=c-mt");
            println!("cargo:rustc-link-lib=static=dlmalloc-mt");
            println!("cargo:rustc-link-lib=static=c++-mt-noexcept");
            println!("cargo:rustc-link-lib=static=c++abi-mt-noexcept");
            println!("cargo:rustc-link-lib=static=compiler_rt-mt");
        }
        println!("cargo:warning=Using LLAMA_WASM_SYSROOT={} for embedded compilation", sysroot);
    }

    for src in c_sources {
        c_build.file(src);
    }
    for src in cxx_sources {
        cxx_build.file(src);
    }

    c_build.compile("llama_engine_embedded_c");
    cxx_build.compile("llama_engine_embedded_cpp");

    println!("cargo:warning=Embedded llama.cpp C/C++ sources compiled for wasm build");
}

