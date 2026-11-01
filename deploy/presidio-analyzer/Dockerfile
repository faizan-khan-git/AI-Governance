# ─────────────────────────────────────────────────────────────────────────────
# Presidio Analyzer for Render (PII detection NER service)
#
# The upstream image already reads $PORT, so Render can route to it. This wrapper
# only bakes in the same recognizer registry the Kubernetes deployment mounts from
# k8s/08-presidio.yaml, so production detects the same entity types as local
# (US/EU/India identifiers, phone, email, IBAN, credit card, ...).
#
# Digest matches k8s/08-presidio.yaml, so this is the build validated locally.
# ─────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/presidio-analyzer@sha256:286e3fa7f3a7426e775e8564fe1870f1ba8f999d3ab8bbb8cc46a44355d9d6e9

ENV RECOGNIZER_REGISTRY_CONF_FILE=/app/conf/recognizers.yaml

COPY recognizers.yaml /app/conf/recognizers.yaml

EXPOSE 3000
