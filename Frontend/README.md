# AI Governance — Frontend Console

A **React + Vite + Tailwind CSS** console for the AI Governance gateway. It talks
directly to the Backend BFF (`/api/chat`, `/health/ready`) and exposes every capability
of the platform: RBAC authentication, model selection, generation controls, PII &
security guardrails (enforced server-side), token/budget usage, and health status.

All API configuration is read from `.env` (Vite `VITE_*`) — nothing is hardcoded.

## Stack & Structure

```
Frontend/
├── index.html
├── vite.config.js / tailwind.config.js / postcss.config.js
├── .env / .env.example
└── src/
    ├── main.jsx                 # Entry — mounts <App> inside <AuthProvider>
    ├── App.jsx                  # Composition + top-level state
    ├── index.css                # Tailwind directives + theme variables
    ├── config/env.js            # Centralized env config (no hardcoded URLs)
    ├── api/                     # client.js (fetch + errors), chat.js, health.js
    ├── context/AuthContext.jsx  # Credential state (JWT / API key), persisted
    ├── hooks/                   # useChat, useHealth
    ├── constants/models.js      # Model catalog + auth schemes (from env)
    ├── utils/                   # jwt.js (decode-for-display), format.js, history.js (+ *.test.js)
    └── components/              # One folder per component + Component.module.css
        ├── Layout/  Header/  HealthBadge/
        ├── AuthPanel/  SettingsPanel/  UsageStats/
        └── ChatWindow/  MessageBubble/  ChatComposer/
```

Each component ships its own `*.module.css`; Tailwind provides the base/reset and
utility layer, while component-specific styling lives in the CSS modules.

## Setup

```bash
cd Frontend
npm install
cp .env.example .env     # adjust VITE_API_BASE_URL if the Backend isn't on :8080
npm run dev              # http://localhost:5173
```

The Backend must be running (default `http://localhost:8080`) and, if RBAC is
enabled, you need a credential:

```bash
# In the Backend, mint a role JWT:
cd ../Backend
node scripts/issue-jwt.mjs --role dev --exp 24h
```

Paste that token into the **Authentication** panel (scheme: JWT), or configure an
API key via the Backend's `RBAC_API_KEYS` and use the **API Key** scheme.

## How it connects

- `api/client.js` builds requests from `config/env.js`, injects the auth header
  (`Authorization: Bearer <jwt>` or `X-API-Key`), enforces a timeout, and maps
  every failure to a typed error the UI renders by code (401/403/timeout/etc.).
- `useChat` sends prompts together with the recent conversation (`history`, see below) and
  stores gateway metadata (model, usage, finish reason); `useHealth` polls `/health/ready`.
- The signing secret is **never** in the frontend — only the already-issued
  token the user supplies. The gateway remains the source of truth for policy.

## Configuration

All settings come from `.env` (template: `.env.example`); nothing is hardcoded.

| Variable                    | `.env.example`          | Description                                                |
| --------------------------- | ----------------------- | ---------------------------------------------------------- |
| `VITE_API_BASE_URL`         | `http://localhost:8080` | Backend BFF base URL (not the LiteLLM gateway)             |
| `VITE_CHAT_PATH`            | `/api/chat`             | Chat endpoint                                              |
| `VITE_READY_PATH`           | `/health/ready`         | Readiness endpoint that drives the header badge            |
| `VITE_DEFAULT_MODEL`        | `gemini-flash`          | Model preselected in the UI                                |
| `VITE_MODELS`               | `gemini-flash,gpt-3.5-turbo,gemini-pro,gpt-4o-mini,gpt-4o` | Comma-separated model catalog   |
| `VITE_DEFAULT_TEMPERATURE`  | `0.7`                   | Default sampling temperature                               |
| `VITE_REQUEST_TIMEOUT_MS`   | `60000`                 | Client request timeout                                     |
| `VITE_HISTORY_MAX_MESSAGES` | `12` (commented out)    | Messages of earlier conversation sent with each prompt     |
| `VITE_HISTORY_MAX_CHARS`    | `24000` (commented out) | Characters of earlier conversation sent with each prompt   |

The Backend only accepts the origins listed in its `CORS_ORIGIN` (default: the Vite dev
server on `:5173`). If Vite starts on another port, add that origin there.

## Conversation memory

The Backend is stateless, so the console sends the recent conversation with every prompt as
`history` and the model can follow up on earlier turns. Only complete exchanges (a question
with its answer) are included — a failed or unanswered prompt is never replayed — and the
most recent exchanges win until `VITE_HISTORY_MAX_MESSAGES` or `VITE_HISTORY_MAX_CHARS` is
reached. Exchanges are never split. Keep both at or below the Backend's
`MAX_HISTORY_MESSAGES` / `MAX_HISTORY_CHARS`.

History passes through the same gateway guardrails as the new prompt, so a phrase on the LLM
Guard ban list that appeared in an earlier reply blocks later turns; clear the chat to start
a new conversation.

## Header status

The badge polls the Backend's readiness endpoint and tells apart three states:

| Badge           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| Backend online  | The Backend is up and can reach the AI gateway                           |
| Gateway offline | The Backend is up, but the gateway is down (`503` from `/health/ready`)  |
| Backend offline | The Backend itself is unreachable                                        |

## Build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
npm test          # unit tests (Node's built-in test runner)
```
