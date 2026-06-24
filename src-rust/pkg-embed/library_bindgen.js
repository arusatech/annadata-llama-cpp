addToLibrary({
    $decodeText: function(ptr, len) {
        return cachedTextDecoder.decode(HEAPU8.subarray(ptr, ptr + len));
    },
    $decodeText__deps: ['$cachedTextDecoder']
});


addToLibrary({
    $getStringFromWasm0: function(ptr, len) {
        return decodeText(ptr >>> 0, len);
    },
    $getStringFromWasm0__deps: ['$decodeText']
});


addToLibrary({
    $addHeapObject: function(obj) {
        if (heap_next === heap.length) heap.push(heap.length + 1);
        const idx = heap_next;
        heap_next = heap[idx];

        heap[idx] = obj;
        return idx;
    },
    $addHeapObject__deps: ['$heap', '$heap_next']
});


addToLibrary({
    $passStringToWasm0: function(arg, malloc, realloc) {
        if (realloc === undefined) {
            const buf = cachedTextEncoder.encode(arg);
            const ptr = malloc(buf.length, 1) >>> 0;
            HEAPU8.subarray(ptr, ptr + buf.length).set(buf);
            WASM_VECTOR_LEN = buf.length;
            return ptr;
        }

        let len = arg.length;
        let ptr = malloc(len, 1) >>> 0;

        const mem = HEAPU8;

        let offset = 0;

        for (; offset < len; offset++) {
            const code = arg.charCodeAt(offset);
            if (code > 0x7F) break;
            mem[ptr + offset] = code;
        }
        if (offset !== len) {
            if (offset !== 0) {
                arg = arg.slice(offset);
            }
            ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
            const view = HEAPU8.subarray(ptr + offset, ptr + len);
            const ret = cachedTextEncoder.encodeInto(arg, view);

            offset += ret.written;
            ptr = realloc(ptr, len, offset, 1) >>> 0;
        }

        WASM_VECTOR_LEN = offset;
        return ptr;
    },
    $passStringToWasm0__deps: ['$cachedTextEncoder', '$WASM_VECTOR_LEN']
});


addToLibrary({
    $getObject: function(idx) { return heap[idx]; },
    $getObject__deps: ['$heap']
});


addToLibrary({
    $dropObject: function(idx) {
        if (idx < 1028) return;
        heap[idx] = heap_next;
        heap_next = idx;
    },
    $dropObject__deps: ['$heap', '$heap_next']
});


addToLibrary({
    $takeObject: function(idx) {
        const ret = getObject(idx);
        dropObject(idx);
        return ret;
    },
    $takeObject__deps: ['$getObject', '$dropObject']
});


addToLibrary({
    $passArray8ToWasm0: function(arg, malloc) {
        const ptr = malloc(arg.length * 1, 1) >>> 0;
        HEAPU8.set(arg, ptr / 1);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    },
    $passArray8ToWasm0__deps: ['$HEAPU8', '$WASM_VECTOR_LEN']
});

addToLibrary({
    $wasm: "null",
    $HEAP_DATA_VIEW: 'undefined',
    $HEAP_DATA_VIEW__postset: "var __wbg_origUpdateMemoryViews = updateMemoryViews; updateMemoryViews = function () { __wbg_origUpdateMemoryViews(); HEAP_DATA_VIEW = new DataView(wasmMemory.buffer); };",
    $WASM_VECTOR_LEN: '0',
    $cachedTextDecoder: "new TextDecoder()",
    $cachedTextEncoder: "new TextEncoder()",
    $heap: "new Array(1024).fill(undefined)",
    $heap__postset: "heap.push(undefined, null, true, false); heap_next = heap.length;",
    $heap_next: '0',
});

addToLibrary({
    __wbindgen_cast_0000000000000001: function(arg0, arg1) {
        // Cast intrinsic for `Ref(String) -> Externref`.
        const ret = getStringFromWasm0(arg0, arg1);
        return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000001__deps: ['$addHeapObject', '$cachedTextDecoder', '$decodeText', '$getStringFromWasm0'],
});

addToLibrary({
    memory: memory || new WebAssembly.Memory({initial:3}),
});






















addToLibrary({
    $initBindgen__deps: ['$HEAP_DATA_VIEW', '$WASM_VECTOR_LEN', '$addHeapObject', '$addOnInit', '$cachedTextDecoder', '$cachedTextEncoder', '$decodeText', '$dropObject', '$getObject', '$getStringFromWasm0', '$heap', '$heap_next', '$passArray8ToWasm0', '$passStringToWasm0', '$takeObject', '$wasm'],
    $initBindgen__postset: 'addOnInit(initBindgen);',
    $initBindgen: () => {
        wasm = wasmExports;
        // Call emscripten's _initialize to run static constructors
        // (needed for --no-entry builds)
        if (wasmExports['_initialize']) {
            wasmExports['_initialize']();
        }
        wasmExports.__wbindgen_start();

        /* @ts-self-types="./llama_engine.d.ts" */

        /**
         * Generate embeddings for text
         * @param {string} model_id
         * @param {string} req_json
         * @returns {string}
         */
        /**
         * Generate embeddings for text
         * @param {string} model_id
         * @param {string} req_json
         * @returns {string}
         */
        function embed(model_id, req_json) {
            let deferred4_0;
            let deferred4_1;
            try {
                const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
                const ptr0 = passStringToWasm0(model_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                const len0 = WASM_VECTOR_LEN;
                const ptr1 = passStringToWasm0(req_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                const len1 = WASM_VECTOR_LEN;
                wasm.embed(retptr, ptr0, len0, ptr1, len1);
                var r0 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 0, true);
                var r1 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 1, true);
                var r2 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 2, true);
                var r3 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 3, true);
                var ptr3 = r0;
                var len3 = r1;
                if (r3) {
                    ptr3 = 0; len3 = 0;
                    throw takeObject(r2);
                }
                deferred4_0 = ptr3;
                deferred4_1 = len3;
                return getStringFromWasm0(ptr3, len3);
            } finally {
                wasm.__wbindgen_add_to_stack_pointer(16);
                wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
            }
        }


        Module.embed = embed;

        /**
         * Generate text from a prompt
         * @param {string} model_id
         * @param {string} req_json
         * @returns {string}
         */
        /**
         * Generate text from a prompt
         * @param {string} model_id
         * @param {string} req_json
         * @returns {string}
         */
        function generate(model_id, req_json) {
            let deferred4_0;
            let deferred4_1;
            try {
                const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
                const ptr0 = passStringToWasm0(model_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                const len0 = WASM_VECTOR_LEN;
                const ptr1 = passStringToWasm0(req_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                const len1 = WASM_VECTOR_LEN;
                wasm.generate(retptr, ptr0, len0, ptr1, len1);
                var r0 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 0, true);
                var r1 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 1, true);
                var r2 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 2, true);
                var r3 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 3, true);
                var ptr3 = r0;
                var len3 = r1;
                if (r3) {
                    ptr3 = 0; len3 = 0;
                    throw takeObject(r2);
                }
                deferred4_0 = ptr3;
                deferred4_1 = len3;
                return getStringFromWasm0(ptr3, len3);
            } finally {
                wasm.__wbindgen_add_to_stack_pointer(16);
                wasm.__wbindgen_export3(deferred4_0, deferred4_1, 1);
            }
        }


        Module.generate = generate;

        /**
         * Get health status of the engine
         * @returns {string}
         */
        /**
         * Get health status of the engine
         * @returns {string}
         */
        function health() {
            let deferred2_0;
            let deferred2_1;
            try {
                const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
                wasm.health(retptr);
                var r0 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 0, true);
                var r1 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 1, true);
                var r2 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 2, true);
                var r3 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 3, true);
                var ptr1 = r0;
                var len1 = r1;
                if (r3) {
                    ptr1 = 0; len1 = 0;
                    throw takeObject(r2);
                }
                deferred2_0 = ptr1;
                deferred2_1 = len1;
                return getStringFromWasm0(ptr1, len1);
            } finally {
                wasm.__wbindgen_add_to_stack_pointer(16);
                wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
            }
        }


        Module.health = health;

        /**
         * Initialize the Wasm engine. Must be called before any other operations.
         */
        /**
         * Initialize the Wasm engine. Must be called before any other operations.
         */
        function init() {
            try {
                const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
                wasm.init(retptr);
                var r0 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 0, true);
                var r1 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 1, true);
                if (r1) {
                    throw takeObject(r0);
                }
            } finally {
                wasm.__wbindgen_add_to_stack_pointer(16);
            }
        }


        Module.init = init;

        /**
         * Load a model from a file path. The model must be in GGUF format.
         * @param {string} model_id
         * @param {Uint8Array} bytes
         * @param {string} opts_json
         */
        /**
         * Load a model from a file path. The model must be in GGUF format.
         * @param {string} model_id
         * @param {Uint8Array} bytes
         * @param {string} opts_json
         */
        function load_model(model_id, bytes, opts_json) {
            try {
                const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
                const ptr0 = passStringToWasm0(model_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                const len0 = WASM_VECTOR_LEN;
                const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_export);
                const len1 = WASM_VECTOR_LEN;
                const ptr2 = passStringToWasm0(opts_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                const len2 = WASM_VECTOR_LEN;
                wasm.load_model(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
                var r0 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 0, true);
                var r1 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 1, true);
                if (r1) {
                    throw takeObject(r0);
                }
            } finally {
                wasm.__wbindgen_add_to_stack_pointer(16);
            }
        }


        Module.load_model = load_model;

        /**
         * Get memory usage snapshot
         * @returns {string}
         */
        /**
         * Get memory usage snapshot
         * @returns {string}
         */
        function memory_snapshot() {
            let deferred2_0;
            let deferred2_1;
            try {
                const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
                wasm.memory_snapshot(retptr);
                var r0 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 0, true);
                var r1 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 1, true);
                var r2 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 2, true);
                var r3 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 3, true);
                var ptr1 = r0;
                var len1 = r1;
                if (r3) {
                    ptr1 = 0; len1 = 0;
                    throw takeObject(r2);
                }
                deferred2_0 = ptr1;
                deferred2_1 = len1;
                return getStringFromWasm0(ptr1, len1);
            } finally {
                wasm.__wbindgen_add_to_stack_pointer(16);
                wasm.__wbindgen_export3(deferred2_0, deferred2_1, 1);
            }
        }


        Module.memory_snapshot = memory_snapshot;

        /**
         * Unload a model and free its resources
         * @param {string} model_id
         */
        /**
         * Unload a model and free its resources
         * @param {string} model_id
         */
        function unload_model(model_id) {
            try {
                const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
                const ptr0 = passStringToWasm0(model_id, wasm.__wbindgen_export, wasm.__wbindgen_export2);
                const len0 = WASM_VECTOR_LEN;
                wasm.unload_model(retptr, ptr0, len0);
                var r0 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 0, true);
                var r1 = HEAP_DATA_VIEW.getInt32(retptr + 4 * 1, true);
                if (r1) {
                    throw takeObject(r0);
                }
            } finally {
                wasm.__wbindgen_add_to_stack_pointer(16);
            }
        }


        Module.unload_model = unload_model;

    }
});

extraLibraryFuncs.push('$initBindgen', '$addOnInit', '$wasm', '$HEAP_DATA_VIEW', '$WASM_VECTOR_LEN', '$cachedTextDecoder', '$cachedTextEncoder', '$heap', '$heap_next');
