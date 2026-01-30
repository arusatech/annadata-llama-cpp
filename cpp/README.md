# Note

- The **project-specific** files in this folder (never overwritten by bootstrap) are:
  - `cap-llama.cpp` / `cap-llama.h` – Capacitor bridge (context, model load)
  - `cap-completion.cpp` / `cap-completion.h` – completion
  - `cap-tts.cpp` / `cap-tts.h` – TTS
  - `cap-embedding.cpp` / `cap-embedding.h` – embeddings
  - `cap-mtmd.hpp` – multimodal/vision
  - `tools/mtmd/` – multimodal/vision tooling
- All other sources are synced from [llama.cpp](https://github.com/ggerganov/llama.cpp).
- **Update native source** (e.g. for a newer llama.cpp or vision support): run from repo root:
  ```bash
  ./scripts/bootstrap.sh [branch-or-tag-or-commit]
  ```
  See [scripts/bootstrap.sh](../scripts/bootstrap.sh) and [docs/IOS_IMPLEMENTATION_GUIDE.md](../docs/IOS_IMPLEMENTATION_GUIDE.md).
