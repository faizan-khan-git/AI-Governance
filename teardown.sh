#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# teardown.sh — Completely removes the AI Gateway cluster and local artefacts
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CLUSTER_NAME="ai-gateway"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}━━━ Tearing Down AI Gateway ━━━${NC}"
echo ""
echo -e "${YELLOW}⚠ This will DELETE the '${CLUSTER_NAME}' cluster and ALL spend/budget data.${NC}"
echo -ne "  Continue? [y/N] "
read -r confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# Delete the k3d cluster (removes all containers, volumes, kubeconfig entry)
if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}"; then
  echo -e "\n  Deleting cluster '${CLUSTER_NAME}'..."
  k3d cluster delete "${CLUSTER_NAME}"
  echo -e "${GREEN}  ✓ Cluster deleted.${NC}"
else
  echo -e "${YELLOW}  Cluster '${CLUSTER_NAME}' not found — nothing to delete.${NC}"
fi

# Remove generated token file (but NOT the secrets file — user may want it)
TOKEN_FILE="$(dirname "${BASH_SOURCE[0]}")/tokens/.env.tokens"
if [[ -f "$TOKEN_FILE" ]]; then
  rm -f "$TOKEN_FILE"
  echo -e "${GREEN}  ✓ Token file removed.${NC}"
fi

echo -e "\n${GREEN}Teardown complete.${NC}"
echo -e "  Run ${YELLOW}./bootstrap.sh${NC} to start fresh."
