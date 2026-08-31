#!/usr/bin/env bash
set -euo pipefail

GATEWAY="http://localhost:30080"
MASTER_KEY="${LITELLM_MASTER_KEY:-}"
OUTPUT_FILE="$(dirname "$0")/.env.tokens"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

if [[ -z "$MASTER_KEY" ]]; then
  echo -e "${RED}ERROR: LITELLM_MASTER_KEY is not set.${NC}"
  echo "  Export it before running:  export LITELLM_MASTER_KEY=sk-my-secret"
  exit 1
fi

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  LiteLLM Virtual Key Provisioner${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

issue_key() {
  local role="$1"
  local payload="$2"
  local alias="${role}-key"

  echo -e "\n${YELLOW}▸ Issuing key for role: ${role}${NC}"

  local existing_token
  existing_token=$(curl -sS "${GATEWAY}/key/list" \
    -H "Authorization: Bearer ${MASTER_KEY}" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
keys = data.get('keys', [])
for k in keys:
    if k.get('key_alias') == '${alias}':
        print(k.get('token', k.get('key', '')))
        break
" 2>/dev/null || true)

  if [[ -n "$existing_token" ]]; then
    echo "  → Found existing '${alias}', deleting..."
    curl -sS -X POST "${GATEWAY}/key/delete" \
      -H "Authorization: Bearer ${MASTER_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"keys\": [\"${existing_token}\"]}" > /dev/null
    echo "  → Deleted."
  fi

  local response
  response=$(curl -sS -X POST "${GATEWAY}/key/generate" \
    -H "Authorization: Bearer ${MASTER_KEY}" \
    -H "Content-Type: application/json" \
    -d "${payload}")

  local token
  token=$(echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('key','ERROR'))" 2>/dev/null || echo "PARSE_ERROR")

  if [[ "$token" == "ERROR" || "$token" == "PARSE_ERROR" ]]; then
    echo -e "${RED}  ✗ Failed to issue key for ${role}${NC}"
    echo "    Response: $response"
    return 1
  fi

  echo -e "${GREEN}  ✓ ${role} token: ${token}${NC}"
  local role_upper
  role_upper=$(echo "$role" | tr '[:lower:]' '[:upper:]')
  echo "export LITELLM_${role_upper}_TOKEN=\"${token}\"" >> "$OUTPUT_FILE"
}

> "$OUTPUT_FILE"
echo "# LiteLLM Virtual Keys — generated $(date)" >> "$OUTPUT_FILE"
echo "# Source this file: source tokens/.env.tokens" >> "$OUTPUT_FILE"

echo -e "\n${CYAN}Waiting for gateway at ${GATEWAY}...${NC}"
for i in $(seq 1 30); do
  if curl -sf "${GATEWAY}/health/readiness" > /dev/null 2>&1; then
    echo -e "${GREEN}  Gateway is healthy.${NC}"
    break
  fi
  echo "  Attempt ${i}/30 — not ready yet, retrying in 3s..."
  sleep 3
done

create_team() {
  local team_id="$1"
  local team_alias="$2"

  local response
  response=$(curl -sS -X POST "${GATEWAY}/team/new" \
    -H "Authorization: Bearer ${MASTER_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"team_id\": \"${team_id}\", \"team_alias\": \"${team_alias}\"}" 2>&1 || true)

  if echo "$response" | grep -qi "error"; then
    echo "  → Team '${team_id}' may already exist (OK)."
  else
    echo -e "${GREEN}  ✓ Created team: ${team_id}${NC}"
  fi
}

echo -e "\n${YELLOW}▸ Creating RBAC teams...${NC}"
create_team "team-dev" "Development"
create_team "team-standard" "Standard"
create_team "team-admin" "Admin"

issue_key "dev" '{
  "team_id": "team-dev",
  "models": ["gemini-flash", "gpt-3.5-turbo"],
  "max_budget": 5,
  "budget_duration": "1mo",
  "tpm_limit": 100000,
  "rpm_limit": 60,
  "metadata": {
    "role": "dev",
    "description": "Development team — cheap models only",
    "created_by": "bootstrap"
  }
}'

issue_key "standard" '{
  "team_id": "team-standard",
  "models": ["gemini-flash", "gemini-pro", "gpt-3.5-turbo", "gpt-4o-mini"],
  "max_budget": 20,
  "budget_duration": "1mo",
  "tpm_limit": 500000,
  "rpm_limit": 200,
  "metadata": {
    "role": "standard",
    "description": "Standard team — no premium models",
    "created_by": "bootstrap"
  }
}'

issue_key "admin" '{
  "team_id": "team-admin",
  "models": ["gemini-flash", "gemini-pro", "gpt-3.5-turbo", "gpt-4o-mini", "gpt-4o"],
  "max_budget": 100,
  "budget_duration": "1mo",
  "tpm_limit": 5000000,
  "rpm_limit": 1000,
  "metadata": {
    "role": "admin",
    "description": "Admin team — all models, high limits",
    "created_by": "bootstrap"
  }
}'

echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ All keys provisioned.${NC}"
echo -e "  Token file: ${CYAN}${OUTPUT_FILE}${NC}"
echo ""
echo -e "  To use them in your shell:"
echo -e "  ${YELLOW}source tokens/.env.tokens${NC}"
echo ""
echo -e "  Then test:"
echo -e "  ${YELLOW}curl http://localhost:30080/v1/chat/completions \\"
echo -e "    -H \"Authorization: Bearer \$LITELLM_DEV_TOKEN\" \\"
echo -e "    -H \"Content-Type: application/json\" \\"
echo -e "    -d '{\"model\":\"gemini-flash\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello!\"}]}'${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
