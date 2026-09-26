# AI Governance — Backend (BFF)

A production-grade **Node.js + Express.js** backend-for-frontend that sits in front of the
[LiteLLM AI Gateway](../README.md). It exposes a single, simple `POST /api/chat` endpoint that:

1. **Receives raw text** (as `text/plain` or JSON).
2. **Formats** it into a standard **OpenAI-compatible** chat-completions payload.
3. **Injects the internal JWT / proxy token** into the `Authorization` header.
4. **Forwards** the payload to the internal LiteLLM Kubernetes service.
5. **Returns the sanitized response** (PII already rehydrated + output-scanned by the gateway)
   as a clean, minimal JSON contract.

---

## Why a BFF?

Clients should never hold the LiteLLM virtual key or know the gateway's internal address.
This backend centralizes credential injection, enforces rate limits, and returns a stable,
minimal response shape — while the gateway itself handles RBAC, budgets, PII masking
(Presidio), and adversarial scanning (LLM Guard).

```
Client ──raw text──▶  Backend (/api/chat)  ──OpenAI payload + Bearer token──▶  LiteLLM Gateway
                          │                                                        │
                          └──────────────  sanitized JSON  ◀────────────────────────┘
```

---

## Project Structure

```
Backend/
├── package.json
├── .env.example
├── .gitignore
├── Dockerfile
└── src/
    ├── server.js                 # Entry point: config validation, startup, graceful shutdown
    ├── app.js                    # Express app assembly (security, parsers, routes, errors)
    ├── config/
    │   └── index.js              # Centralized, validated configuration
    ├── routes/
    │   ├── index.js              # /health + /api mount
    │   └── chat.routes.js        # POST /api/chat
    ├── controllers/
    │   └── chat.controller.js    # Request parsing + orchestration
    ├── services/
    │   └── litellm.service.js    # Payload building + token injection + forwarding
    ├── middlewares/
    │   ├── notFound.js           # 404 handler
    │   └── errorHandler.js       # Centralized error envelope
    └── utils/
        ├── ApiError.js           # Typed HTTP error
        ├── logger.js             # Structured JSON logger
        └── sanitize.js           # Final response-shaping / sanitization
```

---

## Setup

```bash
cd Backend
npm install
cp .env.example .env
# Edit .env — set LITELLM_PROXY_TOKEN and LITELLM_BASE_URL
```

Grab a virtual key from the gateway (see the root README) and set it as the proxy token:

```bash
source ../tokens/.env.tokens
# Then put one of these into .env as LITELLM_PROXY_TOKEN:
#   $LITELLM_DEV_TOKEN  /  $LITELLM_STANDARD_TOKEN  /  $LITELLM_ADMIN_TOKEN
```

> For **local development** against the NodePort gateway, set
> `LITELLM_BASE_URL=http://localhost:30080`.
> When **deployed inside the cluster**, keep the default internal service URL.

---

## Run

```bash
npm run dev     # watch mode
# or
npm start
```

The server listens on `http://localhost:8080` by default.

---

## API

### `POST /api/chat`

Send raw text as `text/plain`:

```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: text/plain" \
  --data "Explain Kubernetes in one sentence."
```

Or as JSON with optional overrides:

```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Write a haiku about AI governance.",
    "model": "gemini-flash",
    "temperature": 0.7,
    "system": "You are a concise assistant."
  }'
```

**Accepted JSON fields:** `text` (or `message` / `prompt`), `model`, `temperature`, `system`.

**Success response:**

```json
{
  "success": true,
  "data": {
    "id": "chatcmpl-...",
    "model": "gemini-flash",
    "created": 1740000000,
    "finish_reason": "stop",
    "message": { "role": "assistant", "content": "..." },
    "usage": {
      "prompt_tokens": 12,
      "completion_tokens": 20,
      "total_tokens": 32
    }
  }
}
```

**Error response:**

```json
{
  "success": false,
  "error": {
    "code": "invalid_request",
    "message": "Request must include non-empty text."
  }
}
```

### `GET /health`

Liveness probe — returns `{ "status": "ok" }`.

---

## Configuration

| Variable               | Default                                                  | Description                                     |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| `PORT`                 | `8080`                                                   | HTTP port                                       |
| `NODE_ENV`             | `development`                                            | Environment                                     |
| `LITELLM_BASE_URL`     | `http://litellm-internal.litellm.svc.cluster.local:4000` | Gateway base URL                                |
| `LITELLM_PROXY_TOKEN`  | _(required)_                                             | Internal JWT / virtual key injected as `Bearer` |
| `DEFAULT_MODEL`        | `gemini-flash`                                           | Model used when the client omits one            |
| `DEFAULT_TEMPERATURE`  | `0.7`                                                    | Default sampling temperature                    |
| `REQUEST_TIMEOUT_MS`   | `60000`                                                  | Upstream request timeout                        |
| `CORS_ORIGIN`          | `*`                                                      | Comma-separated allowed origins                 |
| `RATE_LIMIT_WINDOW_MS` | `60000`                                                  | Rate-limit window                               |
| `RATE_LIMIT_MAX`       | `60`                                                     | Max requests per window per IP                  |

---

## Security Notes

- The proxy token is injected **only** in the service layer and is **never** returned to clients
  or written to logs.
- Streaming is disabled so the gateway can fully rehydrate masked PII before responding.
- Upstream errors are normalized — internal URLs, tokens, and stack traces never reach the client.
- `helmet`, CORS allow-listing, request size limits, and per-IP rate limiting are enabled by default.
