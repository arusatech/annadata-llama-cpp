#include "cap-native-server.h"
#include "cap-embedding.h"

#include "httplib.h"

#include "nlohmann/json.hpp"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using json = nlohmann::ordered_json;

extern "C" {
int64_t llama_init_context(const char * model_path, const char * params_json);
void llama_release_context(int64_t context_id);
const char * llama_completion(int64_t context_id, const char * params_json);
const char * llama_get_formatted_chat(int64_t context_id, const char * messages_json, const char * chat_template,
                                      const char * params_json);
const char * llama_get_context_model_json(int64_t context_id);
const char * llama_tokenize(int64_t context_id, const char * text, const char * image_paths_json);
const char * llama_detokenize(int64_t context_id, const char * tokens_json);
}

namespace {

std::mutex g_mu;
std::unique_ptr<httplib::Server> g_srv;
std::thread g_thr;
std::atomic<int64_t> g_ctx{-1};
std::atomic<bool> g_started{false};

void set_cors(httplib::Response & res) {
    res.set_header("Access-Control-Allow-Origin", "*");
    res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

bool parse_openai_chat(const std::string & body, std::string & model_out, json & messages_out, int & max_tokens_out,
                       double & temperature_out, bool & stream_out) {
    try {
        json b = json::parse(body);
        if (b.contains("model") && b["model"].is_string()) {
            model_out = b["model"].get<std::string>();
        }
        if (!b.contains("messages") || !b["messages"].is_array()) {
            return false;
        }
        messages_out = b["messages"];
        max_tokens_out = b.value("max_tokens", 256);
        if (b.contains("temperature") && b["temperature"].is_number()) {
            temperature_out = b["temperature"].get<double>();
        } else {
            temperature_out = 0.7;
        }
        stream_out = b.value("stream", false);
        return true;
    } catch (...) {
        return false;
    }
}

bool parse_openai_completion(const std::string & body, std::string & model_out, std::string & prompt_out, int & max_tokens_out,
                             double & temperature_out, bool & stream_out) {
    try {
        json b = json::parse(body);
        if (b.contains("model") && b["model"].is_string()) {
            model_out = b["model"].get<std::string>();
        }
        if (!b.contains("prompt") || !b["prompt"].is_string()) {
            return false;
        }
        prompt_out = b["prompt"].get<std::string>();
        max_tokens_out = b.value("max_tokens", 256);
        if (b.contains("temperature") && b["temperature"].is_number()) {
            temperature_out = b["temperature"].get<double>();
        } else {
            temperature_out = 0.7;
        }
        stream_out = b.value("stream", false);
        return true;
    } catch (...) {
        return false;
    }
}

json make_openai_error(const std::string & message, const std::string & type = "invalid_request_error") {
    return json{{"error", json{{"message", message}, {"type", type}}}};
}

json openai_completion_response(const std::string & model, const std::string & text, int prompt_tokens, int completion_tokens,
                                int64_t created) {
    json choice = json::object(
        {{"index", 0},
         {"text", text},
         {"finish_reason", "stop"}});
    return {{"id", std::string("cmpl-cap-") + std::to_string(created)},
            {"object", "text_completion"},
            {"created", created},
            {"model", model.empty() ? "local" : model},
            {"choices", json::array({choice})},
            {"usage", json{{"prompt_tokens", prompt_tokens},
                           {"completion_tokens", completion_tokens},
                           {"total_tokens", prompt_tokens + completion_tokens}}}};
}

bool parse_embedding_request(const std::string & body, std::string & model_out, std::vector<std::string> & inputs_out) {
    try {
        json b = json::parse(body);
        if (b.contains("model") && b["model"].is_string()) {
            model_out = b["model"].get<std::string>();
        }
        if (!b.contains("input")) {
            return false;
        }
        const auto & input = b["input"];
        if (input.is_string()) {
            inputs_out.push_back(input.get<std::string>());
            return true;
        }
        if (input.is_array()) {
            for (const auto & item : input) {
                if (!item.is_string()) {
                    return false;
                }
                inputs_out.push_back(item.get<std::string>());
            }
            return !inputs_out.empty();
        }
        return false;
    } catch (...) {
        return false;
    }
}

bool parse_openai_responses(const std::string & body, std::string & model_out, std::string & prompt_out, int & max_tokens_out,
                            double & temperature_out, bool & stream_out) {
    try {
        json b = json::parse(body);
        if (b.contains("model") && b["model"].is_string()) {
            model_out = b["model"].get<std::string>();
        }
        std::string instructions = b.value("instructions", "");
        std::vector<std::string> input_parts;
        if (!b.contains("input")) {
            return false;
        }
        if (b["input"].is_string()) {
            input_parts.push_back(b["input"].get<std::string>());
        } else if (b["input"].is_array()) {
            for (const auto & item : b["input"]) {
                if (!item.is_string()) {
                    return false;
                }
                input_parts.push_back(item.get<std::string>());
            }
        } else {
            return false;
        }
        if (input_parts.empty()) {
            return false;
        }

        prompt_out.clear();
        if (!instructions.empty()) {
            prompt_out += instructions;
            prompt_out += "\n\n";
        }
        for (size_t i = 0; i < input_parts.size(); ++i) {
            if (i > 0) {
                prompt_out += "\n";
            }
            prompt_out += input_parts[i];
        }

        max_tokens_out = b.value("max_output_tokens", b.value("max_tokens", 256));
        if (b.contains("temperature") && b["temperature"].is_number()) {
            temperature_out = b["temperature"].get<double>();
        } else {
            temperature_out = 0.7;
        }
        stream_out = b.value("stream", false);
        return true;
    } catch (...) {
        return false;
    }
}

std::vector<std::string> chunk_text_for_stream(const std::string & text, size_t max_chunk_chars = 24) {
    std::vector<std::string> chunks;
    if (text.empty()) {
        return chunks;
    }

    std::string current;
    for (const char ch : text) {
        current.push_back(ch);
        const bool at_boundary = (ch == ' ' || ch == '\n' || ch == '\t');
        if (current.size() >= max_chunk_chars && at_boundary) {
            chunks.push_back(current);
            current.clear();
        }
    }
    if (!current.empty()) {
        chunks.push_back(current);
    }
    return chunks;
}

std::vector<std::string> token_level_chunks_for_stream(int64_t ctx_id, const std::string & text) {
    if (text.empty()) {
        return {};
    }

    const char * tokenized = llama_tokenize(ctx_id, text.c_str(), "[]");
    if (!tokenized) {
        return chunk_text_for_stream(text);
    }

    std::vector<std::string> chunks;
    try {
        json tk = json::parse(tokenized);
        if (!tk.contains("tokens") || !tk["tokens"].is_array()) {
            return chunk_text_for_stream(text);
        }
        for (const auto & tok : tk["tokens"]) {
            if (!tok.is_number_integer()) {
                continue;
            }
            json one = json::array({tok.get<int>()});
            const std::string one_json = one.dump();
            const char * piece = llama_detokenize(ctx_id, one_json.c_str());
            if (!piece) {
                continue;
            }
            std::string s(piece);
            if (!s.empty()) {
                chunks.push_back(std::move(s));
            }
        }
    } catch (...) {
        return chunk_text_for_stream(text);
    }

    if (chunks.empty()) {
        return chunk_text_for_stream(text);
    }
    return chunks;
}

int embedding_size_from_context(int64_t ctx_id) {
    const char * model_info = llama_get_context_model_json(ctx_id);
    if (!model_info) {
        return 0;
    }
    try {
        json mi = json::parse(model_info);
        if (mi.contains("nEmbd") && mi["nEmbd"].is_number_integer()) {
            return mi["nEmbd"].get<int>();
        }
    } catch (...) {
    }
    return 0;
}

bool run_prompt_completion(int64_t ctx_id, const std::string & prompt, int max_tokens, double temperature, json & cr_out,
                           std::string & text_out, int & prompt_tokens_out, int & completion_tokens_out, json & err_out) {
    json comp = json::object();
    comp["prompt"] = prompt;
    comp["n_predict"] = max_tokens;
    comp["temperature"] = temperature;

    const char * out = llama_completion(ctx_id, comp.dump().c_str());
    if (!out) {
        err_out = make_openai_error("completion failed", "server_error");
        return false;
    }

    json cr;
    try {
        cr = json::parse(out);
    } catch (...) {
        err_out = make_openai_error("bad completion JSON", "server_error");
        return false;
    }
    if (cr.contains("error")) {
        err_out = cr;
        return false;
    }

    std::string text;
    if (cr.contains("content") && cr["content"].is_string()) {
        text = cr["content"].get<std::string>();
    } else if (cr.contains("text") && cr["text"].is_string()) {
        text = cr["text"].get<std::string>();
    }

    cr_out = std::move(cr);
    text_out = std::move(text);
    prompt_tokens_out = cr_out.value("tokens_evaluated", 0);
    completion_tokens_out = cr_out.value("tokens_predicted", 0);
    return true;
}

void register_routes(httplib::Server & svr, int64_t ctx_id) {
    svr.set_default_headers({{"Server", "llama-cpp-capacitor-native"},
                             {"Access-Control-Allow-Origin", "*"},
                             {"Access-Control-Allow-Methods", "GET, POST, OPTIONS"},
                             {"Access-Control-Allow-Headers", "Content-Type, Authorization"}});

    svr.Options(".*", [](const httplib::Request &, httplib::Response & res) {
        set_cors(res);
        res.status = 204;
        return;
    });

    svr.Get("/health", [](const httplib::Request &, httplib::Response & res) {
        set_cors(res);
        res.set_content(json{{"status", "ok"}}.dump(), "application/json");
    });

    svr.Get("/v1/health", [](const httplib::Request &, httplib::Response & res) {
        set_cors(res);
        res.set_content(json{{"status", "ok"}}.dump(), "application/json");
    });

    svr.Get("/v1/models", [ctx_id](const httplib::Request &, httplib::Response & res) {
        (void)ctx_id;
        set_cors(res);
        json data = json::array();
        data.push_back(json{{"id", "local"}, {"object", "model"}, {"owned_by", "local"}});
        res.set_content(json{{"object", "list"}, {"data", data}}.dump(), "application/json");
    });

    auto chat_handler = [ctx_id](const httplib::Request & req, httplib::Response & res) {
        set_cors(res);
        std::string model;
        json messages;
        int max_tokens = 256;
        double temperature = 0.7;
        bool stream = false;
        if (!parse_openai_chat(req.body, model, messages, max_tokens, temperature, stream)) {
            res.status = 400;
            res.set_content(make_openai_error("invalid JSON or missing messages").dump(), "application/json");
            return;
        }
        const std::string messages_str = messages.dump();
        const char * formatted = llama_get_formatted_chat(ctx_id, messages_str.c_str(), "", nullptr);
        if (!formatted) {
            res.status = 500;
            res.set_content(make_openai_error("format chat failed", "server_error").dump(), "application/json");
            return;
        }
        json fc;
        try {
            fc = json::parse(formatted);
        } catch (...) {
            res.status = 500;
            res.set_content(make_openai_error("bad formatted chat JSON", "server_error").dump(), "application/json");
            return;
        }
        if (fc.contains("error")) {
            res.status = 400;
            res.set_content(fc.dump(), "application/json");
            return;
        }
        if (!fc.contains("prompt") || !fc["prompt"].is_string()) {
            res.status = 400;
            res.set_content(make_openai_error("no prompt in formatted chat").dump(), "application/json");
            return;
        }
        json cr;
        std::string text;
        int prompt_tokens = 0;
        int completion_tokens = 0;
        json err;
        if (!run_prompt_completion(ctx_id, fc["prompt"].get<std::string>(), max_tokens, temperature, cr, text, prompt_tokens,
                                   completion_tokens, err)) {
            res.status = err.contains("error") && err["error"].is_object() ? 500 : 400;
            res.set_content(err.dump(), "application/json");
            return;
        }

        const int64_t created =
            static_cast<int64_t>(std::chrono::system_clock::to_time_t(std::chrono::system_clock::now()));
        const std::string id = std::string("chatcmpl-cap-") + std::to_string(created);
        const std::string model_name = model.empty() ? "local" : model;

        if (!stream) {
            json choice = json::object(
                {{"index", 0},
                 {"message", json::object({{"role", "assistant"}, {"content", text}})},
                 {"finish_reason", "stop"}});
            json out = {{"id", id},
                        {"object", "chat.completion"},
                        {"created", created},
                        {"model", model_name},
                        {"choices", json::array({choice})},
                        {"usage", json{{"prompt_tokens", prompt_tokens},
                                       {"completion_tokens", completion_tokens},
                                       {"total_tokens", prompt_tokens + completion_tokens}}}};
            res.set_content(out.dump(), "application/json");
            return;
        }

        std::vector<std::string> chunks = token_level_chunks_for_stream(ctx_id, text);
        res.set_header("Cache-Control", "no-cache");
        res.set_header("Connection", "keep-alive");
        res.set_chunked_content_provider(
            "text/event-stream", [chunks = std::move(chunks), id, model_name, created](size_t, httplib::DataSink & sink) {
                json first = {{"id", id},
                              {"object", "chat.completion.chunk"},
                              {"created", created},
                              {"model", model_name},
                              {"choices", json::array({json{{"index", 0},
                                                            {"delta", json{{"role", "assistant"}}},
                                                            {"finish_reason", nullptr}}})}};
                const std::string first_line = std::string("data: ") + first.dump() + "\n\n";
                sink.write(first_line.c_str(), first_line.size());

                for (const auto & ch : chunks) {
                    json chunk = {{"id", id},
                                  {"object", "chat.completion.chunk"},
                                  {"created", created},
                                  {"model", model_name},
                                  {"choices", json::array({json{{"index", 0},
                                                                {"delta", json{{"content", ch}}},
                                                                {"finish_reason", nullptr}}})}};
                    const std::string line = std::string("data: ") + chunk.dump() + "\n\n";
                    sink.write(line.c_str(), line.size());
                }

                json final_chunk = {{"id", id},
                                    {"object", "chat.completion.chunk"},
                                    {"created", created},
                                    {"model", model_name},
                                    {"choices", json::array({json{{"index", 0},
                                                                  {"delta", json::object()},
                                                                  {"finish_reason", "stop"}}})}};
                const std::string final_line = std::string("data: ") + final_chunk.dump() + "\n\n";
                sink.write(final_line.c_str(), final_line.size());
                sink.write("data: [DONE]\n\n", 14);
                sink.done();
                return true;
            });
    };

    svr.Post("/v1/chat/completions", chat_handler);
    // Alias used by some clients and llama.cpp server.
    svr.Post("/chat/completions", chat_handler);

    auto completion_handler = [ctx_id](const httplib::Request & req, httplib::Response & res) {
        set_cors(res);
        std::string model;
        std::string prompt;
        int max_tokens = 256;
        double temperature = 0.7;
        bool stream = false;
        if (!parse_openai_completion(req.body, model, prompt, max_tokens, temperature, stream)) {
            res.status = 400;
            res.set_content(make_openai_error("invalid JSON or missing prompt").dump(), "application/json");
            return;
        }
        json cr;
        std::string text;
        int prompt_tokens = 0;
        int completion_tokens = 0;
        json err;
        if (!run_prompt_completion(ctx_id, prompt, max_tokens, temperature, cr, text, prompt_tokens, completion_tokens, err)) {
            res.status = err.contains("error") && err["error"].is_object() ? 500 : 400;
            res.set_content(err.dump(), "application/json");
            return;
        }

        const int64_t created =
            static_cast<int64_t>(std::chrono::system_clock::to_time_t(std::chrono::system_clock::now()));
        const std::string id = std::string("cmpl-cap-") + std::to_string(created);
        const std::string model_name = model.empty() ? "local" : model;
        json payload = openai_completion_response(model_name, text, prompt_tokens, completion_tokens, created);

        if (!stream) {
            res.set_content(payload.dump(), "application/json");
            return;
        }

        std::vector<std::string> chunks = token_level_chunks_for_stream(ctx_id, text);
        res.set_header("Cache-Control", "no-cache");
        res.set_header("Connection", "keep-alive");
        res.set_chunked_content_provider(
            "text/event-stream",
            [chunks = std::move(chunks), id, model_name, created](size_t, httplib::DataSink & sink) {
                for (const auto & ch : chunks) {
                    json chunk = {{"id", id},
                                  {"object", "text_completion"},
                                  {"created", created},
                                  {"model", model_name},
                                  {"choices", json::array({json{{"index", 0},
                                                                {"text", ch},
                                                                {"finish_reason", nullptr}}})}};
                    const std::string line = std::string("data: ") + chunk.dump() + "\n\n";
                    sink.write(line.c_str(), line.size());
                }

                json final_chunk = {{"id", id},
                                    {"object", "text_completion"},
                                    {"created", created},
                                    {"model", model_name},
                                    {"choices", json::array({json{{"index", 0},
                                                                  {"text", ""},
                                                                  {"finish_reason", "stop"}}})}};
                const std::string final_line = std::string("data: ") + final_chunk.dump() + "\n\n";
                sink.write(final_line.c_str(), final_line.size());
                sink.write("data: [DONE]\n\n", 14);
                sink.done();
                return true;
            });
    };

    svr.Post("/v1/completions", completion_handler);
    svr.Post("/completions", completion_handler);

    auto responses_handler = [ctx_id](const httplib::Request & req, httplib::Response & res) {
        set_cors(res);
        std::string model;
        std::string prompt;
        int max_tokens = 256;
        double temperature = 0.7;
        bool stream = false;
        if (!parse_openai_responses(req.body, model, prompt, max_tokens, temperature, stream)) {
            res.status = 400;
            res.set_content(make_openai_error("invalid JSON or missing input").dump(), "application/json");
            return;
        }

        json cr;
        std::string text;
        int prompt_tokens = 0;
        int completion_tokens = 0;
        json err;
        if (!run_prompt_completion(ctx_id, prompt, max_tokens, temperature, cr, text, prompt_tokens, completion_tokens, err)) {
            res.status = err.contains("error") && err["error"].is_object() ? 500 : 400;
            res.set_content(err.dump(), "application/json");
            return;
        }

        const int64_t created =
            static_cast<int64_t>(std::chrono::system_clock::to_time_t(std::chrono::system_clock::now()));
        const std::string response_id = std::string("resp-cap-") + std::to_string(created);
        const std::string model_name = model.empty() ? "local" : model;

        json message = {{"id", std::string("msg-cap-") + std::to_string(created)},
                        {"type", "message"},
                        {"role", "assistant"},
                        {"content", json::array({json{{"type", "output_text"}, {"text", text}}})}};

        json response_obj = {{"id", response_id},
                             {"object", "response"},
                             {"created_at", created},
                             {"model", model_name},
                             {"status", "completed"},
                             {"output", json::array({message})},
                             {"output_text", text},
                             {"usage", json{{"input_tokens", prompt_tokens},
                                            {"output_tokens", completion_tokens},
                                            {"total_tokens", prompt_tokens + completion_tokens}}}};
        json response_created = response_obj;
        response_created["status"] = "in_progress";
        response_created["output"] = json::array();
        response_created["output_text"] = "";
        response_created["usage"] = json{{"input_tokens", prompt_tokens}, {"output_tokens", 0}, {"total_tokens", prompt_tokens}};

        if (!stream) {
            res.set_content(response_obj.dump(), "application/json");
            return;
        }

        std::vector<std::string> chunks = token_level_chunks_for_stream(ctx_id, text);
        res.set_header("Cache-Control", "no-cache");
        res.set_header("Connection", "keep-alive");
        res.set_chunked_content_provider(
            "text/event-stream",
            [response_id, response_created, response_obj, chunks = std::move(chunks)](size_t, httplib::DataSink & sink) {
                json created_event = {{"type", "response.created"}, {"response", response_created}};
                const std::string created_line = std::string("data: ") + created_event.dump() + "\n\n";
                sink.write(created_line.c_str(), created_line.size());

                for (const auto & ch : chunks) {
                    json delta_event = {{"type", "response.output_text.delta"}, {"response_id", response_id}, {"delta", ch}};
                    const std::string delta_line = std::string("data: ") + delta_event.dump() + "\n\n";
                    sink.write(delta_line.c_str(), delta_line.size());
                }

                json completed_event = {{"type", "response.completed"}, {"response", response_obj}};
                const std::string completed_line = std::string("data: ") + completed_event.dump() + "\n\n";
                sink.write(completed_line.c_str(), completed_line.size());
                sink.write("data: [DONE]\n\n", 14);
                sink.done();
                return true;
            });
    };

    svr.Post("/v1/responses", responses_handler);
    svr.Post("/responses", responses_handler);

    auto embeddings_handler = [ctx_id](const httplib::Request & req, httplib::Response & res) {
        set_cors(res);
        std::string model;
        std::vector<std::string> inputs;
        if (!parse_embedding_request(req.body, model, inputs)) {
            res.status = 400;
            res.set_content(make_openai_error("invalid JSON or missing input").dump(), "application/json");
            return;
        }

        const int n_embd = embedding_size_from_context(ctx_id);
        if (n_embd <= 0) {
            res.status = 500;
            res.set_content(make_openai_error("embedding size unavailable", "server_error").dump(), "application/json");
            return;
        }

        json data = json::array();
        int index = 0;
        for (const auto & input : inputs) {
            float * vec = llama_embedding(ctx_id, input.c_str(), "{}");
            if (!vec) {
                res.status = 500;
                res.set_content(make_openai_error("embedding failed", "server_error").dump(), "application/json");
                return;
            }
            json emb = json::array();
            for (int i = 0; i < n_embd; ++i) {
                emb.push_back(vec[i]);
            }
            data.push_back(json{{"object", "embedding"}, {"embedding", emb}, {"index", index++}});
        }

        json payload = {{"object", "list"},
                        {"data", data},
                        {"model", model.empty() ? "local" : model},
                        {"usage", json{{"prompt_tokens", 0}, {"total_tokens", 0}}}};
        res.set_content(payload.dump(), "application/json");
    };

    svr.Post("/v1/embeddings", embeddings_handler);
    svr.Post("/embeddings", embeddings_handler);
}

} // namespace

int cap_llama_server_start(const char * model_path, const char * host, int port, const char * params_json) {
    if (!model_path || !host) {
        return 0;
    }
    std::lock_guard<std::mutex> lock(g_mu);
    if (g_started.load()) {
        return 0;
    }

    int64_t id = llama_init_context(model_path, params_json ? params_json : "");
    if (id < 0) {
        return 0;
    }
    g_ctx.store(id);

    auto svr = std::make_unique<httplib::Server>();
    register_routes(*svr, id);

    g_srv = std::move(svr);
    const std::string host_owned(host);
    g_thr = std::thread([host_owned, port]() {
        if (g_srv) {
            g_srv->listen(host_owned.c_str(), port);
        }
    });

    if (g_srv) {
        g_srv->wait_until_ready();
        if (!g_srv->is_running()) {
            g_srv->stop();
            if (g_thr.joinable()) {
                g_thr.join();
            }
            g_srv.reset();
            llama_release_context(id);
            g_ctx.store(-1);
            return 0;
        }
    }

    g_started.store(true);
    return 1;
}

void cap_llama_server_stop(void) {
    std::unique_ptr<httplib::Server> srv;
    std::thread thr;
    int64_t id = -1;
    {
        std::lock_guard<std::mutex> lock(g_mu);
        if (!g_started.load()) {
            return;
        }
        id = g_ctx.load();
        srv = std::move(g_srv);
        thr = std::move(g_thr);
        g_started.store(false);
    }
    if (srv) {
        srv->stop();
    }
    if (thr.joinable()) {
        thr.join();
    }
    {
        std::lock_guard<std::mutex> lock(g_mu);
        g_srv.reset();
        g_ctx.store(-1);
    }
    if (id >= 0) {
        llama_release_context(id);
    }
}

int cap_llama_server_is_running(void) {
    std::lock_guard<std::mutex> lock(g_mu);
    return (g_started.load() && g_srv && g_srv->is_running()) ? 1 : 0;
}

int cap_llama_server_main(int argc, char ** argv) {
    const char * model = nullptr;
    std::string host = "127.0.0.1";
    int port = 8080;
    json pj;

    for (int i = 1; i < argc; i++) {
        if (!argv[i]) {
            break;
        }
        std::string a = argv[i];
        if ((a == "-m" || a == "--model") && i + 1 < argc) {
            model = argv[++i];
        } else if (a == "--host" && i + 1 < argc) {
            host = argv[++i];
        } else if (a == "--port" && i + 1 < argc) {
            port = std::atoi(argv[++i]);
        } else if ((a == "-c" || a == "--ctx-size" || a == "-n") && i + 1 < argc) {
            pj["n_ctx"] = std::atoi(argv[++i]);
        }
    }
    if (!model) {
        return 1;
    }
    std::string pj_str;
    if (pj.is_object() && !pj.empty()) {
        pj_str = pj.dump();
    }
    return cap_llama_server_start(model, host.c_str(), port, pj_str.empty() ? nullptr : pj_str.c_str()) ? 0 : 1;
}
