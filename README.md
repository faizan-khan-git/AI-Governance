# AI Governance — LiteLLM AI Gateway & Admin Portal

A production-quality, GitOps-managed LiteLLM proxy deployed into a local Kubernetes cluster
with RBAC-controlled virtual keys, hard budget enforcement, rate limits, model-access restrictions,
Presidio PII vault, LLM Guard security scanners, zero-retention audit logging, and a full-featured
**AI Governance Admin Portal** for real-time telemetry, flagged prompt investigations, and per-user token quotas.

---

## Quick Start

```bash
# 1. Start Docker Desktop

# 2. Set your provider API keys
export GEMINI_API_KEY="AIza..."
export OPENAI_API_KEY="sk-..."

# 3. Bootstrap everything (installs k3d, creates cluster, deploys all services & schemas)
chmod +x bootstrap.sh teardown.sh tokens/generate-virtual-keys.sh
./bootstrap.sh

# 4. Source your RBAC tokens
source tokens/.env.tokens
```

The gateway is live at **http://localhost:30080** (published on `127.0.0.1` only).

### Start the Applications

```bash
# In Terminal 1 — Start the Backend BFF (Port 8080)
cd Backend
npm install
npm start

# In Terminal 2 — Start the Frontend Console & Admin Portal (Port 5173)
cd Frontend
npm install
npm run dev
```

- **Chat Console**: `http://localhost:5173`
- **Admin Governance Portal**: `http://localhost:5173/admin` (Requires `role: admin` JWT)

```bash
# Mint an Admin JWT to sign into the Admin Portal:
cd Backend
node scripts/issue-jwt.mjs --role admin --sub admin@governance.local
```

---

## Architecture

```
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │                           Host Machine (127.0.0.1)                               │
  │                                                                                  │
  │   Frontend Console (:5173)             Backend BFF (:8080)                       │
  │   ┌───────────────────────────┐        ┌──────────────────────────────────────┐  │
  │   │  Chat Console (/)         │        │  Express BFF & RBAC Gatekeeper       │  │
  │   │  Admin Portal (/admin)    │───────▶│  - POST /api/chat (checkQuota)       │  │
  │   │  - Overview & Analytics   │        │  - GET  /api/admin/* (requireAdmin)  │  │
  │   │  - Flagged Prompts & PII  │        │  - Auto-forward to Postgres :5433    │  │
  │   │  - Quotas & User Directory│        └──────────────────┬───────────────────┘  │
  │   └───────────────────────────┘                           │                      │
  └─────────────────────────────┼─────────────────────────────┼──────────────────────┘
                                │                             │
  ┌─────────────────────────────┼─────────────────────────────┼──────────────────────┐
  │                             ▼ :30080 (NodePort)           ▼ :5433 (Postgres)     │
  │           k3d Cluster: "ai-gateway" (Namespace: litellm)                         │
  │  ┌────────────────────────────────────────────────────────────────────────────┐  │
  │  │  LiteLLM Proxy     ← ConfigMap (proxy_config.yaml)                         │  │
  │  │  PostgreSQL        ← Spend + AI Registry + Token Quotas (ai_registry)      │  │
  │  │  Redis             ← Rate limits + Short-lived PII token vault (AUTH req.) │  │
  │  │  Presidio          ← Analyzer (NLP) + Anonymizer (PII masking/rehydrate)   │  │
  │  │  LLM Guard         ← Prompt injection / jailbreak / toxicity scanners      │  │
  │  │  Registry Logger   ← Metadata-only audit log callback (zero text retention)│  │
  │  └────────────────────────────────────────────────────────────────────────────┘  │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

---

## AI Governance Admin Portal (`/admin`)

The platform includes a dedicated, dark glassmorphism administrator portal designed for governance, risk, and compliance (GRC) teams:

### 1. 📊 Governance Overview
- **Real-Time KPIs**: Track total requests, unique pseudonymous callers, token utilization, upstream cost (USD), security interventions, PII masking events, and registered AI systems.
- **30-Day Activity Trends**: Interactive visual charts tracking token consumption and request volume over time.
- **Top Consumers Leaderboard**: Immediate visibility into the highest volume users, their spend, and security flags.

### 2. 📋 Audit Log Explorer
- **Zero-Retention Audit Trail**: Inspect detailed metadata for every gateway transaction without storing prompt or response text.
- **Dynamic Filtering**: Filter and search by user hash, model, HTTP status code, date range, or toggle security interventions and PII masks.
- **Telemetry Inspector**: Click any row to inspect request IDs, model latencies, token distributions (prompt vs. completion), and guardrail outputs.

### 3. 🚩 Flagged Prompts & Security Interventions
- **Who Triggered It**: Full visibility into prompts intercepted by ML scanners, mapped to the caller's pseudonymous hash (`end_user`) and display name.
- **Scanner Breakdown**: See exactly which scanner fired:
  - `BanSubstrings`: Jailbreaks and adversarial personas (e.g. DAN).
  - `PromptInjection`: Adversarial injection detected via transformer classifiers.
  - `Toxicity`: Hate speech, harassment, and abusive prompts.
  - `Regex`: Secret keys and sensitive credentials.
- **Action Breakdown**: Differentiate between requests **Blocked** (HTTP 400) versus **Flagged** (monitor-only advisory).

### 4. 🔒 Privacy Compliance & PII Incidents
- **Masked Entity Distributions**: Real-time breakdown of all PII entities intercepted and stored in the Redis vault (`PERSON`, `EMAIL_ADDRESS`, `LOCATION`, `PHONE_NUMBER`, `CREDIT_CARD`, `US_SSN`, `IN_AADHAAR`, `IN_PAN`, etc.).
- **Incident Timeline**: Correlate data masking frequency with specific users and models.

### 5. 👥 User Directory & Search Telemetry
- **Caller Telemetry**: Per-user consumption metrics, request counts, spend, and security risk indicators.
- **User Detail View (`/admin/users/:endUser`)**: Deep dive into individual users with 30-day token utilization graphs and recent request history.

### 6. 📏 Token Quotas & Utilization Controls
- **Hard Ceilings**: Set strict boundaries so users cannot exceed assigned allocations:
  - Daily token ceiling (`daily_token_limit`)
  - Monthly token ceiling (`monthly_token_limit`)
  - Daily cost ceiling (`daily_cost_limit_usd`)
  - Monthly cost ceiling (`monthly_cost_limit_usd`)
- **Real-Time Utilization Meters**: Visual progress meters showing current usage versus assigned limits.
- **1-Click User Suspension**: Instantly block malicious callers (`is_blocked = true`), rejecting subsequent requests with `403 Forbidden`.
- **Fail-Open Quota Enforcement**: If the database is temporarily unreachable, quota checks fail open with a warning log so core chat pipelines never break.

### 7. 🏢 AI Systems Registry & Risk Reviews
- **Centralized Asset Inventory**: Track enterprise AI systems with assigned risk tiers (`minimal`, `limited`, `high`, `unacceptable`), data sensitivities (`public`, `internal`, `confidential`, `restricted`), and business owners.
- **Ethics & Risk Reviews**: Audit trail of formal governance reviews, risk tier transitions, reviewer findings, and review expiration dates.

---

## RBAC Virtual Key Roles

| Role       | Models                          | RPM  | TPM  | Budget/mo |
| ---------- | ------------------------------- | ---- | ---- | --------- |
| `dev`      | `gemini-flash`, `gpt-3.5-turbo` | 60   | 100k | $5        |
| `standard` | + `gemini-pro`, `gpt-4o-mini`   | 200  | 500k | $20       |
| `admin`    | All models incl. `gpt-4o`       | 1000 | 5M   | $100      |

---

## Admin API Reference (`/api/admin/*`)

All admin routes require an `Authorization: Bearer <jwt>` with `role: admin` or an `X-API-Key` mapped to `admin`:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/dashboard` | High-level KPI metrics & top consumer leaderboard |
| `GET` | `/api/admin/dashboard/trends` | 30-day daily token & request volume trends |
| `GET` | `/api/admin/audit-logs` | Paginated, filterable audit log metadata |
| `GET` | `/api/admin/audit-logs/:id` | Single audit transaction detail & inspector |
| `GET` | `/api/admin/flagged` | Security-intervened prompts and scanner distributions |
| `GET` | `/api/admin/pii-incidents` | PII masking events and entity type breakdowns |
| `GET` | `/api/admin/users` | User directory with aggregated token usage |
| `GET` | `/api/admin/users/:endUser` | Individual user detail with 30-day usage history |
| `GET` | `/api/admin/quotas` | List all configured token quotas & utilization meters |
| `PUT` | `/api/admin/quotas/:endUser` | Create or update quota boundaries & block status |
| `DELETE` | `/api/admin/quotas/:endUser` | Remove quota (revert user to unlimited default) |
| `GET` | `/api/admin/systems` | Registered AI systems with consumption stats |
| `GET` | `/api/admin/systems/:id` | Detailed AI system record and risk review history |
| `GET` | `/api/admin/risk-reviews` | All governance risk reviews |

---

## curl Reference

After running `source tokens/.env.tokens`:

### Health & Discovery

```bash
# Gateway health
curl http://localhost:30080/health

# Readiness probe
curl http://localhost:30080/health/readiness

# List all models visible to your token
curl http://localhost:30080/v1/models \
  -H "Authorization: Bearer $LITELLM_DEV_TOKEN"
```

### Chat Completions

```bash
# ── DEV token: standard model (succeeds) ──────────────────────────────
curl http://localhost:30080/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-flash",
    "messages": [{"role": "user", "content": "Explain Kubernetes in one sentence."}],
    "temperature": 0.7
  }'

# ── DEV token: blocked premium model (returns 403) ─────────────────
curl http://localhost:30080/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# ── ADMIN token: premium model (succeeds) ─────────────────────────
curl http://localhost:30080/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What are the risks of uncontrolled AI spending?"}]
  }'
```

### Admin Operations via Backend BFF

```bash
# Mint an admin token
ADMIN_JWT=$(cd Backend && node scripts/issue-jwt.mjs --role admin)

# Query Governance Overview
curl http://localhost:8080/api/admin/dashboard \
  -H "Authorization: Bearer $ADMIN_JWT"

# Query Flagged Prompts
curl "http://localhost:8080/api/admin/flagged?limit=5" \
  -H "Authorization: Bearer $ADMIN_JWT"

# Set a 50,000 daily token limit on a user
curl -X PUT http://localhost:8080/api/admin/quotas/u_601fdcd469671f9c35ea34b1 \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Finance Team Lead",
    "daily_token_limit": 50000,
    "monthly_token_limit": 1000000,
    "daily_cost_limit_usd": 5.00,
    "is_blocked": false
  }'
```

---

## PII Guard (Presidio + Redis Vault)

The gateway masks personally identifiable information (PII) **before** it reaches the LLM,
stores the original values in an in-cluster **Redis vault**, and restores (rehydrates) them in the response.

### Data Flow

```
User prompt                 → "Draft an email for John Smith at john@acme.com"
  ↓ pre_call  — Presidio detects PII, Anonymizer tokenizes it,
  ↓             token map stored in Redis: pii_vault:<id> (TTL 300s)
Sanitized prompt to LLM     → "Draft an email for [PERSON_1] at [EMAIL_ADDRESS_1]"
  ↓ LLM response
LLM reply                   → "Dear [PERSON_1], ..."
  ↓ post_call — token map fetched from Redis, tokens replaced, vault entry deleted
Response to user            → "Dear John Smith, ..."
```

The LLM **never** sees raw PII, and only an opaque vault id travels with the request.

---

## Security Guard (LLM Guard)

A secondary validation layer powered by [LLM Guard](https://github.com/protectai/llm-guard)
that runs **after** Presidio PII masking:

```
User prompt
  ↓ Layer 1: PII vault — mask PII ([PERSON_1], [EMAIL_ADDRESS_1]) → Redis
  ↓ Layer 2: LLM Guard — scan for injection / jailbreak / toxicity
  ↓ (blocked with HTTP 400 if threat detected)
  ↓ LLM Provider
  ↓ Layer 2: LLM Guard — scan output for leaked secrets
  ↓ Layer 1: PII vault — rehydrate placeholders from Redis
Response to user
```

| Scanner | What It Catches | Action |
|---|---|---|
| `BanSubstrings` | Known jailbreak patterns ("ignore previous instructions", "DAN", etc.) | **BLOCK** (HTTP 400) |
| `PromptInjection` | Adversarial prompt injection (DeBERTa ML model) | **FLAG** (Monitor-only) |
| `Toxicity` | Hate speech, threats, harassment, offensive language | **BLOCK** (HTTP 400) |
| `Regex` | Bearer tokens / `sk-` API keys echoed by model output | **BLOCK** (Redacted) |

---

## AI Registry & Database Architecture

The `ai_registry` schema in PostgreSQL has 4 core tables:

| Table | Purpose |
|---|---|
| `ai_systems` | Registered AI systems: owner, risk tier, data sensitivity, lifecycle status |
| `audit_log` | Zero-retention request telemetry — tokens, latency, cost, and guardrail outputs |
| `risk_reviews` | Governance ethics and risk review audit trails |
| `token_quotas` | Per-user token ceilings, budget boundaries, and blocking controls |

### Analytical Views:
- `v_system_usage_summary`: Usage, cost, latency, and guardrail hits rolled up per AI system.
- `v_high_risk_systems`: Filtered to systems classified as `high` or `unacceptable` risk.
- `v_user_usage_summary`: Aggregated token consumption, spend, and security flags per caller.
- `v_user_daily_usage`: Day-by-day utilization for quota boundary enforcement.
- `v_flagged_prompts`: Filtered security interventions with scanner attribution.
- `v_pii_incidents`: PII masking telemetry and entity mapping.
- `v_daily_trends`: 30-day governance trend rollups for visual dashboard graphs.

### Upgrading an Existing Database

The SQL schema migrations are idempotent:

```bash
for f in 01-ai-registry-schema.sql 02-seed-data.sql 03-admin-schema.sql; do
  kubectl exec -i -n litellm postgres-0 -- psql -U litellm -d litellm \
    -v ON_ERROR_STOP=1 --single-transaction -q < sql/$f
done
```

---

## Project Structure

```
AI-Governance/
├── README.md                      ← Platform master documentation
├── bootstrap.sh                   ← One-shot installer (k3d, pods, keys, schemas)
├── teardown.sh                    ← Clean cluster removal
│
├── Backend/                       ← Node.js / Express Backend-for-Frontend (BFF)
│   ├── package.json
│   ├── .env / .env.example
│   ├── src/
│   │   ├── server.js              ← Entry point & graceful shutdown
│   │   ├── app.js                 ← Express app, helmet, cors, rate limiter
│   │   ├── config/                ← Config, parsers, and db.js (PostgreSQL pool)
│   │   ├── auth/                  ← RBAC, HS256 JWT, and endUser HMAC hashing
│   │   ├── middlewares/           ← authenticate, requireAdmin, checkQuota, errorHandler
│   │   ├── routes/                ← chat.routes.js, admin.routes.js, index.js
│   │   ├── controllers/           ← chat.controller.js, admin.controller.js
│   │   └── services/              ← litellm.service.js, health.service.js, admin.service.js
│   ├── scripts/                   ← issue-jwt.mjs, end-user-id.mjs
│   └── test/                      ← 87 unit and integration test suites
│
├── Frontend/                      ← React 18 + Vite + Tailwind Console & Admin Portal
│   ├── package.json
│   ├── vite.config.js
│   ├── src/
│   │   ├── main.jsx               ← BrowserRouter entry
│   │   ├── App.jsx                ← Chat Console (/) and Admin (/admin/*) routing
│   │   ├── api/                   ← client.js, chat.js, admin.js, health.js
│   │   ├── context/               ← AuthContext (JWT/API-key state)
│   │   └── components/
│   │       ├── ChatConsole/       ← Chat window, composer, settings, history
│   │       └── admin/             ← AdminLayout, AdminSidebar, DashboardOverview,
│   │                              ← AuditLogViewer, FlaggedPrompts, PIIIncidents,
│   │                              ← UserManagement, UserDetail, QuotaManager, SystemsOverview
│
├── callbacks/                     ← Mounted at /app/callbacks in LiteLLM pod
│   ├── pii_vault_guardrail.py     ← Presidio + Redis PII vault (mask / rehydrate)
│   ├── llm_guard_guardrail.py     ← LLM Guard input/output scanning
│   └── registry_logger.py         ← Metadata-only AI Registry audit logger
│
├── sql/                           ← Database schemas & migrations
│   ├── 01-ai-registry-schema.sql  ← AI Registry tables, views, indexes
│   ├── 02-seed-data.sql           ← Sample AI systems & risk reviews
│   └── 03-admin-schema.sql        ← Token quotas, user summary views, trend views
│
├── k8s/                           ← Kubernetes manifests (GitOps)
│   ├── 00-namespace.yaml          ← Default-deny NetworkPolicies
│   ├── 01-secrets.yaml            ← Secret template (envsubst applied)
│   ├── 02-postgres.yaml           ← PostgreSQL StatefulSet & PVC
│   ├── 03-redis.yaml              ← Redis AUTH deployment
│   ├── 04-configmap.yaml          ← LiteLLM proxy_config.yaml
│   ├── 05-deployment.yaml         ← LiteLLM deployment
│   ├── 06-service.yaml            ← NodePort 30080 service
│   ├── 07-rbac.yaml               ← Kubernetes ServiceAccount & Role
│   ├── 08-presidio.yaml           ← Presidio Analyzer + Anonymizer
│   ├── 09-llm-guard.yaml          ← LLM Guard API server
│   └── 10-registry-logger.yaml    ← Generated ConfigMap for callbacks
│
└── tokens/
    ├── generate-virtual-keys.sh   ← Provisions RBAC virtual keys
    ├── .env.secrets               ← Internal secrets (mode 600, gitignored)
    └── .env.tokens                ← Provisioned virtual keys (gitignored)
```

---

## Security Invariants

- **Zero-Retention**: By architectural design, no raw prompt or model output text is ever stored in the database.
- **Pseudonymous Attribution**: End users are identified via SHA256 keyed HMACs (`u_<24hex>`), ensuring user anonymity while maintaining governance accountability.
- **Fail-Open Quotas, Fail-Closed Security**: Token utilization boundaries fail open if the database is unreachable to preserve uptime, while PII and injection scanners fail closed.
- **Network Isolation**: The gateway is bound to `127.0.0.1` and internal pod traffic is restricted via Kubernetes NetworkPolicies.
- **Credential Segregation**: Frontend clients never hold upstream API keys; the Backend BFF injects virtual keys dynamically based on authenticated role claims.

---

## Teardown

```bash
./teardown.sh
```

Deletes the k3d cluster, all pods, persistent volumes, and generated token files. Spend history is **not** recoverable after teardown.
