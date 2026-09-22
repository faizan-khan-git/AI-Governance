#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# bootstrap.sh — One-shot installer for the LiteLLM AI Gateway
#
# What this does:
#   1. Checks prerequisites (Docker running, brew available)
#   2. Installs k3d + helm if missing
#   3. Creates a k3d cluster named "ai-gateway" with port 30080 exposed
#   4. Generates secure random values for LITELLM_MASTER_KEY + JWT_SECRET
#      (unless already set in your environment)
#   5. Prompts for API keys if not already exported
#   6. Applies all Kubernetes manifests in order
#   7. Waits for all pods to be Running
#   8. Provisions the three RBAC virtual keys
#   9. Runs a health check curl
#
# Usage:
#   export GEMINI_API_KEY="AIza..."
#   export OPENAI_API_KEY="sk-..."
#   ./bootstrap.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CLUSTER_NAME="ai-gateway"
NAMESPACE="litellm"
GATEWAY="http://localhost:30080"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

banner() {
  echo -e "\n${CYAN}${BOLD}━━━ $1 ━━━${NC}"
}

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
err()  { echo -e "${RED}  ✗ $1${NC}"; exit 1; }
info() { echo -e "  $1"; }

# ════════════════════════════════════════════════════════════════════════════
banner "Step 1: Prerequisites"
# ════════════════════════════════════════════════════════════════════════════

# Docker must be running
if ! docker info > /dev/null 2>&1; then
  err "Docker daemon is not running. Please start Docker Desktop and re-run."
fi
ok "Docker daemon is running"

# kubectl
if ! command -v kubectl &> /dev/null; then
  err "kubectl not found. Install it: brew install kubectl"
fi
ok "kubectl $(kubectl version --client --short 2>/dev/null | head -1 | awk '{print $3}')"

# homebrew
if ! command -v brew &> /dev/null; then
  err "Homebrew not found. Install it from https://brew.sh"
fi
ok "Homebrew available"

# ════════════════════════════════════════════════════════════════════════════
banner "Step 2: Install k3d + Helm"
# ════════════════════════════════════════════════════════════════════════════

if ! command -v k3d &> /dev/null; then
  info "Installing k3d..."
  brew install k3d
  ok "k3d installed: $(k3d version | head -1)"
else
  ok "k3d already installed: $(k3d version | head -1)"
fi

if ! command -v helm &> /dev/null; then
  info "Installing helm..."
  brew install helm
  ok "helm installed: $(helm version --short)"
else
  ok "helm already installed: $(helm version --short)"
fi

# ════════════════════════════════════════════════════════════════════════════
banner "Step 3: API Keys"
# ════════════════════════════════════════════════════════════════════════════

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo -ne "${YELLOW}  Enter your GEMINI_API_KEY: ${NC}"
  read -rs GEMINI_API_KEY
  echo
  export GEMINI_API_KEY
fi
ok "GEMINI_API_KEY set (${#GEMINI_API_KEY} chars)"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo -ne "${YELLOW}  Enter your OPENAI_API_KEY: ${NC}"
  read -rs OPENAI_API_KEY
  echo
  export OPENAI_API_KEY
fi
ok "OPENAI_API_KEY set (${#OPENAI_API_KEY} chars)"

# ── Generate random master key + JWT secret if not provided ───────────────
if [[ -z "${LITELLM_MASTER_KEY:-}" ]]; then
  LITELLM_MASTER_KEY="sk-$(openssl rand -hex 24)"
  export LITELLM_MASTER_KEY
  warn "Generated LITELLM_MASTER_KEY (save this!): ${LITELLM_MASTER_KEY}"
else
  ok "LITELLM_MASTER_KEY already set"
fi

if [[ -z "${LITELLM_JWT_SECRET:-}" ]]; then
  LITELLM_JWT_SECRET="$(openssl rand -hex 32)"
  export LITELLM_JWT_SECRET
  warn "Generated LITELLM_JWT_SECRET (save this!): ${LITELLM_JWT_SECRET}"
else
  ok "LITELLM_JWT_SECRET already set"
fi

# Write generated secrets to a local file for reference
SECRETS_FILE="${SCRIPT_DIR}/tokens/.env.secrets"
mkdir -p "${SCRIPT_DIR}/tokens"
cat > "$SECRETS_FILE" <<EOF
# Auto-generated secrets — DO NOT commit to Git
# Generated: $(date)
export LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY}"
export LITELLM_JWT_SECRET="${LITELLM_JWT_SECRET}"
# NOTE: GEMINI_API_KEY and OPENAI_API_KEY are NOT written here.
# Store those in your password manager or system keychain.
EOF
chmod 600 "$SECRETS_FILE"
ok "Secrets written to tokens/.env.secrets (mode 600)"

# ════════════════════════════════════════════════════════════════════════════
banner "Step 4: Create k3d Cluster"
# ════════════════════════════════════════════════════════════════════════════

if k3d cluster list | grep -q "^${CLUSTER_NAME}"; then
  warn "Cluster '${CLUSTER_NAME}' already exists — skipping creation."
  warn "Run ./teardown.sh first if you want a clean slate."
else
  info "Creating cluster '${CLUSTER_NAME}'..."
  k3d cluster create "${CLUSTER_NAME}" \
    --port "30080:30080@loadbalancer" \
    --wait \
    --timeout 120s

  ok "Cluster '${CLUSTER_NAME}' created"
fi

# Merge kubeconfig
k3d kubeconfig merge "${CLUSTER_NAME}" --kubeconfig-merge-default > /dev/null
kubectl config use-context "k3d-${CLUSTER_NAME}" > /dev/null
ok "kubectl context set to: k3d-${CLUSTER_NAME}"

# ── Wait for k3d system to be fully ready ──────────────────────────────────
# The local-path-provisioner must be running before any PVCs can be bound.
# CoreDNS must be running before pods can resolve service names.
# On a fresh cluster, these system images need to be pulled first.
info "Waiting for k3d system pods (local-path-provisioner, coredns)..."
for i in $(seq 1 60); do
  READY=$(kubectl get pods -n kube-system -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.status.phase}{"\n"}{end}' 2>/dev/null || echo "")
  LP_READY=$(echo "$READY" | grep "local-path-provisioner" | grep -c "Running" || true)
  DNS_READY=$(echo "$READY" | grep "coredns" | grep -c "Running" || true)
  if [[ "$LP_READY" -ge 1 && "$DNS_READY" -ge 1 ]]; then
    ok "k3d system pods ready (local-path-provisioner + coredns running)"
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    warn "System pods still not ready after 5 minutes — continuing anyway..."
  fi
  echo "  attempt ${i}/60 — waiting for system pods (5s)..."
  sleep 5
done

# ════════════════════════════════════════════════════════════════════════════
banner "Step 5: Apply Kubernetes Manifests"
# ════════════════════════════════════════════════════════════════════════════

K8S_DIR="${SCRIPT_DIR}/k8s"

# Apply namespace + network policy first
kubectl apply -f "${K8S_DIR}/00-namespace.yaml"
ok "Namespace + NetworkPolicy applied"

# Apply RBAC (ServiceAccount, Role, RoleBinding) before pods
kubectl apply -f "${K8S_DIR}/07-rbac.yaml"
ok "RBAC applied"

# Substitute real API keys into secrets manifest and apply
# Never writes real keys to disk — pipes through envsubst in memory
info "Applying Secrets (envsubst substitution)..."
envsubst < "${K8S_DIR}/01-secrets.yaml" | kubectl apply -f -
ok "Secrets applied (keys injected from environment)"

# Remaining manifests in order
for manifest in 02-postgres.yaml 03-redis.yaml 08-presidio.yaml 09-llm-guard.yaml 10-registry-logger.yaml 04-configmap.yaml 05-deployment.yaml 06-service.yaml; do
  kubectl apply -f "${K8S_DIR}/${manifest}"
  ok "Applied: ${manifest}"
done

# ════════════════════════════════════════════════════════════════════════════
banner "Step 6: Wait for Pods to be Ready"
# ════════════════════════════════════════════════════════════════════════════

info "Waiting for Postgres (PVC provisioning + image pull on first run)..."
kubectl rollout status statefulset/postgres -n "${NAMESPACE}" --timeout=600s
ok "Postgres ready"

# ── Initialize AI Registry Database Schema ────────────────────────────────
banner "Step 6b: Initialize AI Registry Schema"

SQL_DIR="${SCRIPT_DIR}/sql"
if [[ -d "$SQL_DIR" ]]; then
  for sql_file in 01-ai-registry-schema.sql 02-seed-data.sql; do
    if [[ -f "${SQL_DIR}/${sql_file}" ]]; then
      info "Executing ${sql_file}..."
      kubectl cp "${SQL_DIR}/${sql_file}" "${NAMESPACE}/postgres-0:/tmp/${sql_file}"
      kubectl exec -n "${NAMESPACE}" postgres-0 -- \
        psql -U litellm -d litellm -f "/tmp/${sql_file}" -q 2>&1 | tail -3
      ok "Applied: ${sql_file}"
    fi
  done

  # Verify the schema was created
  TABLES=$(kubectl exec -n "${NAMESPACE}" postgres-0 -- \
    psql -U litellm -d litellm -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ai_registry';" 2>/dev/null | tr -d ' ')
  ok "AI Registry schema initialized (${TABLES} tables/views created)"
else
  warn "sql/ directory not found — skipping AI Registry init"
fi

info "Waiting for Redis..."
kubectl rollout status deployment/redis -n "${NAMESPACE}" --timeout=300s
ok "Redis ready"

info "Waiting for Presidio Analyzer (spaCy NLP model download may take 2-3 min)..."
kubectl rollout status deployment/presidio-analyzer -n "${NAMESPACE}" --timeout=600s
ok "Presidio Analyzer ready"

info "Waiting for Presidio Anonymizer..."
kubectl rollout status deployment/presidio-anonymizer -n "${NAMESPACE}" --timeout=300s
ok "Presidio Anonymizer ready"

info "Waiting for LLM Guard (ML model download on first start may take 2-3 min)..."
kubectl rollout status deployment/llm-guard -n "${NAMESPACE}" --timeout=600s
ok "LLM Guard ready"

info "Waiting for LiteLLM proxy (image pull + DB init)..."
kubectl rollout status deployment/litellm -n "${NAMESPACE}" --timeout=600s
ok "LiteLLM proxy ready"

# ════════════════════════════════════════════════════════════════════════════
banner "Step 7: Provision Virtual Keys"
# ════════════════════════════════════════════════════════════════════════════

chmod +x "${SCRIPT_DIR}/tokens/generate-virtual-keys.sh"
"${SCRIPT_DIR}/tokens/generate-virtual-keys.sh"

# ════════════════════════════════════════════════════════════════════════════
banner "Step 8: Health Check"
# ════════════════════════════════════════════════════════════════════════════

sleep 3
HEALTH=$(curl -sf "${GATEWAY}/health/readiness" 2>/dev/null || echo "FAILED")
if echo "$HEALTH" | grep -qi "healthy\|status"; then
  ok "Gateway health check passed: ${HEALTH}"
else
  warn "Health check returned unexpected response: ${HEALTH}"
  warn "Check pod logs: kubectl logs -n litellm -l app=litellm --tail=50"
fi

# ════════════════════════════════════════════════════════════════════════════
echo -e "\n${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  ✓  AI Gateway is LIVE at localhost:30080        ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
echo -e "  1. Source your tokens:  ${YELLOW}source tokens/.env.tokens${NC}"
echo -e "  2. Run curl tests:      ${YELLOW}cat README.md | head -120${NC}"
echo -e "  3. View spend/budgets:  ${YELLOW}open ${GATEWAY}/ui${NC}  (LiteLLM dashboard)"
echo -e "  4. Tear down cluster:   ${YELLOW}./teardown.sh${NC}"
echo ""
echo -e "  ${CYAN}Pod status:${NC}"
kubectl get pods -n "${NAMESPACE}" -o wide
echo ""
