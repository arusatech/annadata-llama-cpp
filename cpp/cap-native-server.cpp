#include "cap-native-server.h"

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

using json = nlohmann::ordered_json;

extern "C" {
int64_t llama_init_context(const char * model_path, const char * params_json);
void llama_release_context(int64_t context_id);
const char * llama_completion(int64_t context_id, const char * params_json);
const char * llama_get_formatted_chat(int64_t context_id, const char * messages_json, const char * chat_template,
                                      const char * params_json);
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
                       double & temperature_out) {
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
        return true;
    } catch (...) {
        return false;
    }
}

std::string openai_chat_response(const std::string & model, const std::string & content) {
    const int64_t t = static_cast<int64_t>(std::chrono::system_clock::to_time_t(std::chrono::system_clock::now()));
    json choice = json::object(
        {{"index", 0},
         {"message", json::object({{"role", "assistant"}, {"content", content}})},
         {"finish_reason", "stop"}});
    json out = {{"id", std::string("chatcmpl-cap-") + std::to_string(t)},
                {"object", "chat.completion"},
                {"created", t},
                {"model", model.empty() ? "local" : model},
                {"choices", json::array({choice})}};
    return out.dump();
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

    svr.Post("/v1/chat/completions", [ctx_id](const httplib::Request & req, httplib::Response & res) {
        set_cors(res);
        std::string model;
        json messages;
        int max_tokens = 256;
        double temperature = 0.7;
        if (!parse_openai_chat(req.body, model, messages, max_tokens, temperature)) {
            res.status = 400;
            res.set_content(json{{"error", json{{"message", "invalid JSON or missing messages"}, {"type", "invalid_request_error"}}}}.dump(),
                            "application/json");
            return;
        }
        const std::string messages_str = messages.dump();
        const char * formatted = llama_get_formatted_chat(ctx_id, messages_str.c_str(), "", nullptr);
        if (!formatted) {
            res.status = 500;
            res.set_content(json{{"error", "format chat failed"}}.dump(), "application/json");
            return;
        }
        json fc;
        try {
            fc = json::parse(formatted);
        } catch (...) {
            res.status = 500;
            res.set_content(json{{"error", "bad formatted chat JSON"}}.dump(), "application/json");
            return;
        }
        if (fc.contains("error")) {
            res.status = 400;
            res.set_content(fc.dump(), "application/json");
            return;
        }
        if (!fc.contains("prompt") || !fc["prompt"].is_string()) {
            res.status = 400;
            res.set_content(json{{"error", "no prompt in formatted chat"}}.dump(), "application/json");
            return;
        }
        json comp = json::object();
        comp["prompt"] = fc["prompt"].get<std::string>();
        comp["n_predict"] = max_tokens;
        comp["temperature"] = temperature;
        const char * out = llama_completion(ctx_id, comp.dump().c_str());
        if (!out) {
            res.status = 500;
            res.set_content(json{{"error", "completion failed"}}.dump(), "application/json");
            return;
        }
        json cr;
        try {
            cr = json::parse(out);
        } catch (...) {
            res.status = 500;
            res.set_content(json{{"error", "bad completion JSON"}}.dump(), "application/json");
            return;
        }
        if (cr.contains("error")) {
            res.status = 500;
            res.set_content(out, "application/json");
            return;
        }
        std::string text;
        if (cr.contains("content") && cr["content"].is_string()) {
            text = cr["content"].get<std::string>();
        } else if (cr.contains("text") && cr["text"].is_string()) {
            text = cr["text"].get<std::string>();
        }
        res.set_content(openai_chat_response(model, text), "application/json");
    });
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
