# AI Governance — Backend (BFF)

A production-grade **Node.js + Express.js** backend-for-frontend that sits in front of the
[LiteLLM AI Gateway](../README.md). It exposes a single, simple `POST /api/chat` endpoint that:

1. **Receives raw text** (as `text/plain` or JSON), optionally with the earlier turns of the conversation.
2. **Validates** it and **formats** it into a standard **OpenAI-compatible** chat-completions payload.
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
├── src/
│   ├── server.js                 # Entry point: config validation, startup, graceful shutdown
│   ├── app.js                    # Express app assembly (security, parsers, routes, errors)
│   ├── config/
│   │   ├── index.js              # Centralized configuration (incl. RBAC)
│   │   ├── parsers.js            # Pure env parsers (booleans, TRUST_PROXY, API-key map)
│   │   └── validate.js           # Startup validation: errors + hardening warnings
│   ├── auth/
│   │   ├── roles.js              # Canonical RBAC roles (dev|standard|admin)
│   │   ├── jwt.js                # Dependency-free HS256 sign/verify (exp required)
│   │   ├── endUser.js            # Pseudonymous end-user id (keyed HMAC of the subject)
│   │   └── virtualKeyResolver.js # role → LiteLLM virtual key
│   ├── routes/
│   │   ├── index.js              # /health, /health/ready + /api mount
│   │   └── chat.routes.js        # POST /api/chat (RBAC-protected)
│   ├── controllers/
│   │   └── chat.controller.js    # Orchestration: validate → build payload → forward
│   ├── validators/
│   │   └── chat.validator.js     # Request validation: model, temperature, system, history
│   ├── services/
│   │   ├── litellm.service.js    # Payload building + per-role key forwarding
│   │   └── health.service.js     # Cached gateway-readiness check
│   ├── middlewares/
│   │   ├── authenticate.js       # RBAC: resolve caller role → virtual key + end-user id
│   │   ├── notFound.js           # 404 handler
│   │   └── errorHandler.js       # Centralized error envelope (incl. body-parser errors)
│   └── utils/
│       ├── ApiError.js           # Typed HTTP error
│       ├── logger.js             # Structured JSON logger
│       └── sanitize.js           # Final response-shaping / sanitization
├── scripts/
│   ├── issue-jwt.mjs             # Mint HS256 role JWTs for testing/clients
│   └── end-user-id.mjs           # Map a subject to its pseudonymous end-user id
└── test/                         # node:test suites — unit + HTTP integration, no network
```

---

## Setup

```bash
cd Backend
npm install
cp .env.example .env
# Edit .env — set AUTH_JWT_SECRET (generate one with: openssl rand -hex 32)
# and LITELLM_BASE_URL
```

The per-role gateway keys (`LITELLM_DEV_TOKEN`, `LITELLM_STANDARD_TOKEN`,
`LITELLM_ADMIN_TOKEN`) are loaded automatically from `../tokens/.env.tokens` once the
gateway has been bootstrapped (see the root README). They can also be exported or set in
`.env`; a real environment variable always wins over the file.

> For **local development** against the NodePort gateway, set
> `LITELLM_BASE_URL=http://localhost:30080`.
> When **deployed inside the cluster**, keep the default internal service URL.

On startup the configuration is validated. The server **refuses to start** when it is
unsafe or incomplete (missing or placeholder `AUTH_JWT_SECRET`, no role tokens, an invalid
`TRUST_PROXY`, `RBAC_ENABLED=false`, …). Hardening issues — documented example API keys,
keys shorter than 32 characters, `CORS_ORIGIN=*` — are logged as warnings in development
and become startup errors when `NODE_ENV=production`.

---

## Run

```bash
npm run dev     # watch mode
# or
npm start
```

The server listens on `http://127.0.0.1:8080` by default — loopback only. Set
`HOST=0.0.0.0` to expose it; the Dockerfile does, because a container must listen on all
interfaces.

```bash
npm test        # unit + HTTP integration tests (node:test, no network or gateway needed)
```

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

**Accepted JSON fields:** `text` (or `message` / `prompt`), `model`, `temperature` (0–2),
`system`, `history`. Unknown fields are ignored.

#### Multi-turn conversations

The Backend is stateless. To continue a conversation, send the earlier turns in `history`
(oldest first); `text` is the new user message:

```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "text": "And how does it scale?",
    "history": [
      { "role": "user",      "content": "What is Kubernetes?" },
      { "role": "assistant", "content": "A container orchestrator." }
    ]
  }'
```

- History roles are `user` and `assistant` only (the system prompt has its own field);
  any other field of an entry is dropped.
- Limits: at most `MAX_HISTORY_MESSAGES` entries, `MAX_TEXT_LENGTH` characters per message
  and `MAX_HISTORY_CHARS` in total. Anything larger is rejected with `413`, anything
  malformed with `400`.
- History passes through the same guardrails as the new message: PII is masked (the same
  value gets the same token across all turns) and LLM Guard scans every role, so a client
  cannot smuggle an instruction in by forging an `assistant` turn. The flip side: a phrase
  on the LLM Guard ban list that appeared in an earlier reply blocks later turns of that
  conversation — start a new conversation to clear it.

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

### Request errors

| Status | `error.code`             | Meaning                                                                |
| ------ | ------------------------ | ---------------------------------------------------------------------- |
| 400    | `invalid_request`        | Empty text, or a malformed `model` / `temperature` / `system` / `history` |
| 400    | `invalid_json`           | The body is not valid JSON                                             |
| 413    | `payload_too_large`      | The body, a message, the system prompt or the history is over its limit |
| 415    | `unsupported_media_type` | Unsupported request encoding or charset                                |

Errors returned by the gateway itself (guardrail blocks, budget, provider failures) are
normalized into the same envelope.

### `GET /health`

Liveness probe — returns `{ "status": "ok", "service": "ai-governance-backend" }`. It checks
no dependencies, so a gateway outage never gets the Backend restarted.

### `GET /health/ready`

Readiness probe — `200` when the Backend can reach the LiteLLM gateway, otherwise `503`
with `{ "status": "degraded", "checks": { "gateway": "down" } }`. The result is cached for
5 seconds. The Frontend's health badge uses it to tell "Gateway offline" apart from
"Backend offline".

---

## RBAC (per-request role → virtual key)

RBAC is **always enforced**: the Backend authenticates every `/api/chat` caller, resolves
their **role**, and forwards the request using the LiteLLM virtual key for that
role. The gateway then enforces the role's model allowlist, rate limits, and
budget. The Backend never trusts the client to pick a key — it maps role → key
itself. The gateway remains the single source of truth for policy.

It needs the per-role gateway keys (`LITELLM_DEV/STANDARD/ADMIN_TOKEN`, loaded from
`../tokens/.env.tokens` automatically) and at least one of the auth mechanisms below.
There is no unauthenticated mode, and `RBAC_ENABLED=false` is rejected at startup.

### Auth mechanisms

**1. JWT (HS256)** — send a signed token whose `role` claim is `dev|standard|admin`:

```bash
# Mint a token (signed with AUTH_JWT_SECRET)
TOKEN=$(node scripts/issue-jwt.mjs --role dev --sub alice --exp 24h)

curl -X POST http://localhost:8080/api/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Explain AI governance.","model":"gemini-flash"}'
```

Tokens must carry an `exp` claim — a token without one is rejected, so credentials cannot
live forever. `issue-jwt.mjs` defaults to 8 hours (`--exp 24h`, `--exp 3600`, …).

**2. API key** — map static keys to roles via `RBAC_API_KEYS` and send `X-API-Key`:

```bash
# Generate long random keys with: openssl rand -hex 32
# .env:  RBAC_API_KEYS={"<random-64-hex>":"dev","<another-random-64-hex>":"admin"}
curl -X POST http://localhost:8080/api/chat \
  -H "X-API-Key: <random-64-hex>" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello"}'
```

Use random keys of at least 32 characters. Short keys, placeholders and the example keys
that older versions of this README showed (`dev-abc123`, `admin-xyz789`) are flagged at
startup — and refused when `NODE_ENV=production` — because anyone who has read the docs
could use them to authenticate.

### RBAC error codes

| Status | `error.code`           | Meaning                            |
| ------ | ---------------------- | ---------------------------------- |
| 401    | `unauthenticated`      | No credential provided             |
| 401    | `invalid_token`        | Bad/expired JWT                    |
| 401    | `invalid_api_key`      | Unrecognized API key               |
| 403    | `invalid_role_claim`   | JWT role claim is not a known role |
| 403    | `role_not_provisioned` | Role has no configured virtual key |

> `LITELLM_PROXY_TOKEN` is deprecated and ignored: the gateway key is always chosen from the
> caller's role.

### Audit attribution

Every request is attributed in the gateway's audit log (`ai_registry.audit_log`, see the
root README):

- **Caller** — the Backend sends a **pseudonymous** end-user id in the
  `x-litellm-end-user-id` header: `u_` plus a keyed hash (HMAC-SHA256) of the JWT `sub`
  (or `apikey:<role>` for API keys). Raw subjects — often email addresses — never reach the
  gateway, the model provider or the audit tables. Map an id back to a person with
  `node scripts/end-user-id.mjs --sub alice@example.com`. The key is `AUTH_END_USER_KEY`
  (default `AUTH_JWT_SECRET`); changing it changes every id.
- **AI system** — set `AI_SYSTEM` to the registered system (name or id) this Backend serves.
  It is sent as `metadata.ai_system`, and the gateway attributes the usage to it only when it
  belongs to the caller's team. Without it a request is attributed only when its team has
  exactly one registered system; otherwise it stays unattributed rather than guessed.

---

## Configuration

| Variable                 | Default                                                  | Description                                                                      |
| ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `PORT`                   | `8080`                                                   | HTTP port                                                                        |
| `HOST`                   | `127.0.0.1`                                              | Interface to bind; use `0.0.0.0` in a container (the Dockerfile sets it)         |
| `NODE_ENV`               | `development`                                            | `production` turns hardening warnings into startup errors                        |
| `TRUST_PROXY`            | _(unset: trust none)_                                    | Reverse proxies in front of the app (e.g. `1`) or trusted addresses/CIDRs; `true` is rejected |
| `LITELLM_BASE_URL`       | `http://litellm-internal.litellm.svc.cluster.local:4000` | Gateway base URL                                                                 |
| `AUTH_JWT_SECRET`        | `LITELLM_JWT_SECRET`                                     | HS256 secret to verify caller JWTs (≥ 32 chars, not a placeholder)               |
| `AUTH_END_USER_KEY`      | `AUTH_JWT_SECRET`                                        | HMAC key for the pseudonymous end-user ids                                       |
| `LITELLM_DEV_TOKEN`      | _(none)_                                                 | Virtual key for the `dev` role                                                   |
| `LITELLM_STANDARD_TOKEN` | _(none)_                                                 | Virtual key for the `standard` role                                              |
| `LITELLM_ADMIN_TOKEN`    | _(none)_                                                 | Virtual key for the `admin` role                                                 |
| `RBAC_API_KEYS`          | _(none)_                                                 | JSON map of `{"apiKey":"role"}` for `X-API-Key`; random keys of ≥ 32 characters  |
| `AI_SYSTEM`              | _(none)_                                                 | Registered AI system (name or id) that usage is attributed to                    |
| `DEFAULT_MODEL`          | `gemini-flash`                                           | Model used when the client omits one                                             |
| `DEFAULT_TEMPERATURE`    | `0.7`                                                    | Default sampling temperature                                                     |
| `REQUEST_TIMEOUT_MS`     | `60000`                                                  | Upstream request timeout                                                         |
| `CORS_ORIGIN`            | `http://localhost:5173,http://127.0.0.1:5173`            | Comma-separated allowed origins; `*` only when set explicitly (rejected in production) |
| `MAX_TEXT_LENGTH`        | `32000`                                                  | Maximum characters in one message                                                |
| `MAX_SYSTEM_LENGTH`      | `8000`                                                   | Maximum characters in the system prompt                                          |
| `MAX_HISTORY_MESSAGES`   | `40`                                                     | Maximum entries in `history`                                                     |
| `MAX_HISTORY_CHARS`      | `64000`                                                  | Maximum total characters across `history`                                        |
| `RATE_LIMIT_WINDOW_MS`   | `60000`                                                  | Rate-limit window                                                                |
| `RATE_LIMIT_MAX`         | `60`                                                     | Max requests per window per IP                                                   |

`LITELLM_PROXY_TOKEN` and `RBAC_ENABLED` are no longer used (see [RBAC](#rbac-per-request-role--virtual-key)).

---

## Security Notes

- The role's virtual key is injected **only** in the service layer and is **never** returned to
  clients or written to logs.
- Streaming is disabled so the gateway can fully rehydrate masked PII before responding.
- Upstream errors are normalized — internal URLs, tokens, and stack traces never reach the client.
- `helmet`, CORS allow-listing, request size limits, and per-IP rate limiting are enabled by default.
- The server binds to loopback and CORS defaults to the Vite dev origins (never `*`). The rate
  limiter keys on the connecting address and ignores `X-Forwarded-For` unless `TRUST_PROXY` is
  set, so a client cannot spoof its IP to dodge the limit.
- JWTs must carry an `exp` claim, and the configuration is validated at startup (see
  [Setup](#setup)).
