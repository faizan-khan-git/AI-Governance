# ─────────────────────────────────────────────────────────────────────────────
# Presidio Anonymizer for Render (PII tokenization service)
#
# The upstream image already reads $PORT and serves /health, so this wrapper only
# pins the digest that is validated in k8s/08-presidio.yaml. It is kept as a
# Dockerfile (rather than deploying the image directly) so every guardrail service
# builds the same way from this repository.
# ─────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/presidio-anonymizer@sha256:a10a12a2a613d13cf29d3ad3641e3258444dd8c90403dd644a0a114c472c2483

EXPOSE 3000
