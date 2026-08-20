# AI Governance — LiteLLM AI Gateway

A production-quality, GitOps-managed LiteLLM proxy deployed into a local Kubernetes cluster
with RBAC-controlled virtual keys, hard budget enforcement, rate limits, and model-access restrictions.

---

## Quick Start

```bash
# 1. Start Docker Desktop

# 2. Set your API keys
export GEMINI_API_KEY="AIza..."
export OPENAI_API_KEY="sk-..."

# 3. Bootstrap everything (installs k3d, creates cluster, deploys all services)
chmod +x bootstrap.sh teardown.sh tokens/generate-virtual-keys.sh
./bootstrap.sh

# 4. Source your RBAC tokens
source tokens/.env.tokens
```

That's it — the gateway is live at **http://localhost:30080**.

---

## Architecture

```
  ┌─────────────────────────────────────────────────────┐
  │           k3d Cluster: "ai-gateway"                  │
  │                                                       │
  │  Namespace: litellm                                   │
  │  ┌──────────────────────────────────────────────┐    │
  │  │  LiteLLM Proxy  ← ConfigMap (proxy_config)   │    │
  │  │  PostgreSQL     ← Budget / spend / key store │    │
  │  │  Redis          ← Rate-limit sliding window  │    │
  │  └──────────────────────────────────────────────┘    │
  │                                                       │
  │  NodePort 30080 → LiteLLM :4000                      │
  └─────────────────────────────────────────────────────┘
```

---

## RBAC Virtual Key Roles

| Role | Models | RPM | TPM | Budget/mo |
|------|--------|-----|-----|-----------|
| `dev` | `gemini-flash`, `gpt-3.5-turbo` | 60 | 100k | $5 |
| `standard` | + `gemini-pro`, `gpt-4o-mini` | 200 | 500k | $20 |
| `admin` | All models incl. `gpt-4o` | 1000 | 5M | $100 |

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
# ── DEV token: cheap model (should succeed) ──────────────────────────────
curl http://localhost:30080/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-flash",
    "messages": [{"role": "user", "content": "Explain Kubernetes in one sentence."}],
    "temperature": 0.7
  }'

# ── DEV token: blocked premium model (should return 403) ─────────────────
curl http://localhost:30080/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# ── STANDARD token: mid-tier model ───────────────────────────────────────
curl http://localhost:30080/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_STANDARD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Write a haiku about AI governance."}]
  }'

# ── ADMIN token: premium model ────────────────────────────────────────────
curl http://localhost:30080/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What are the risks of uncontrolled AI spending?"}]
  }'
```

### Admin Operations (Master Key)

```bash
# View current spend for all keys
curl http://localhost:30080/spend/logs \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"

# View all virtual keys
curl http://localhost:30080/key/list \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"

# Check spend for a specific key
curl "http://localhost:30080/spend/logs?api_key=$LITELLM_DEV_TOKEN" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"

# Revoke a key
curl -X DELETE http://localhost:30080/key/delete \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"keys\": [\"$LITELLM_DEV_TOKEN\"]}"

# Issue a new custom key on the fly
curl -X POST http://localhost:30080/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key_alias": "contractor-alice",
    "models": ["gemini-flash"],
    "max_budget": 2,
    "budget_duration": "1mo",
    "rpm_limit": 30,
    "metadata": {"user": "alice@example.com"}
  }'
```

---

## File Structure

```
AI-Governance/
├── README.md                      ← This file
├── bootstrap.sh                   ← One-shot installer
├── teardown.sh                    ← Clean cluster removal
│
├── k8s/
│   ├── 00-namespace.yaml          ← Namespace + NetworkPolicy
│   ├── 01-secrets.yaml            ← API key Secret (placeholder values)
│   ├── 02-postgres.yaml           ← PostgreSQL StatefulSet + PVC + Service
│   ├── 03-redis.yaml              ← Redis Deployment + Service
│   ├── 04-configmap.yaml          ← proxy_config.yaml (models, budgets, router)
│   ├── 05-deployment.yaml         ← LiteLLM Deployment
│   ├── 06-service.yaml            ← ClusterIP + NodePort :30080
│   └── 07-rbac.yaml               ← ServiceAccount, Role, RoleBinding
│
└── tokens/
    ├── generate-virtual-keys.sh   ← Provisions dev/standard/admin tokens
    ├── .env.secrets               ← Master key + JWT secret (mode 600, gitignored)
    └── .env.tokens                ← Virtual keys after provisioning (gitignored)
```

---

## Useful kubectl Commands

```bash
# Watch all pods
kubectl get pods -n litellm -w

# Tail LiteLLM logs
kubectl logs -n litellm -l app=litellm -f --tail=100

# Tail Postgres logs
kubectl logs -n litellm -l app=postgres -f --tail=50

# Describe deployment
kubectl describe deployment litellm -n litellm

# Port-forward directly (alternative to NodePort)
kubectl port-forward -n litellm svc/litellm-internal 4000:4000

# Exec into LiteLLM pod
kubectl exec -it -n litellm deployment/litellm -- /bin/sh
```

---

## Resetting Virtual Keys

```bash
# Re-run key provisioner at any time
source tokens/.env.secrets
./tokens/generate-virtual-keys.sh
source tokens/.env.tokens
```

---

## Security Notes

- **Never commit** `tokens/.env.secrets` or `tokens/.env.tokens` — add both to `.gitignore`
- Real API keys are injected via `envsubst` in memory at apply time — never written to disk
- The LiteLLM pod runs as **non-root** (`runAsUser: 1000`) with all Linux capabilities dropped
- NetworkPolicy restricts the namespace to DNS + HTTPS egress only
- The Kubernetes RBAC `Role` grants the pod access to **only its own Secret**

---

## Teardown

```bash
./teardown.sh
```

Deletes the k3d cluster, all containers, PVCs, and token files. Spend history is **not** recoverable after teardown.
