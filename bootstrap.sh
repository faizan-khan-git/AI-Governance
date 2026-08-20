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
for manifest in 02-postgres.yaml 03-redis.yaml 04-configmap.yaml 05-deployment.yaml 06-service.yaml; do
  kubectl apply -f "${K8S_DIR}/${manifest}"
  ok "Applied: ${manifest}"
done

# ════════════════════════════════════════════════════════════════════════════
banner "Step 6: Wait for Pods to be Ready"
# ════════════════════════════════════════════════════════════════════════════

info "Waiting for Postgres..."
kubectl rollout status statefulset/postgres -n "${NAMESPACE}" --timeout=180s
ok "Postgres ready"

info "Waiting for Redis..."
kubectl rollout status deployment/redis -n "${NAMESPACE}" --timeout=120s
ok "Redis ready"

info "Waiting for LiteLLM proxy (may take 60-90s for image pull + DB init)..."
kubectl rollout status deployment/litellm -n "${NAMESPACE}" --timeout=300s
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
HEALTH=$(curl -sf "${GATEWAY}/health" 2>/dev/null || echo "FAILED")
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
