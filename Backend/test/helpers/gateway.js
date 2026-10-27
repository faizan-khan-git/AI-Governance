import http from "node:http";

/**
 * A stand-in for the LiteLLM gateway used by the integration tests.
 *
 *  - GET  /health/readiness       → 200, or 503 while `state.ready` is false
 *  - POST /v1/chat/completions    → records the request and echoes how many
 *                                   messages it received; model "denied" → 403
 */
export async function startStubGateway({ ready = true } = {}) {
  const state = { ready, chatRequests: [] };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const send = (status, payload) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      if (req.method === "GET" && req.url === "/health/readiness") {
        return send(state.ready ? 200 : 503, {
          status: state.ready ? "healthy" : "unhealthy",
        });
      }

      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        state.chatRequests.push({ headers: req.headers, body });
        if (body.model === "denied") {
          return send(403, {
            error: { message: "model not allowed for this key", code: "403" },
          });
        }
        return send(200, {
          id: "chatcmpl-stub",
          model: body.model,
          created: 1,
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: `received ${body.messages.length} message(s)`,
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        });
      }

      return send(404, { error: "not found" });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

/** Listen on an ephemeral loopback port and return the base URL plus a closer. */
export async function listen(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
