# AI Governance — Frontend Console

A **React + Vite + Tailwind CSS** console for the AI Governance gateway. It talks
directly to the Backend BFF (`/api/chat`, `/health`) and exposes every capability
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
    ├── utils/                   # jwt.js (decode-for-display), format.js
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
- `useChat` sends prompts and stores gateway metadata (model, usage, finish
  reason); `useHealth` polls `/health`.
- The signing secret is **never** in the frontend — only the already-issued
  token the user supplies. The gateway remains the source of truth for policy.

## Build

```bash
npm run build     # outputs to dist/
npm run preview   # serve the production build locally
```
