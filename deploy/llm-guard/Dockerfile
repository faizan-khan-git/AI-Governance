# ─────────────────────────────────────────────────────────────────────────────
# LLM Guard API for Render (prompt-injection / jailbreak / toxicity scanning)
#
# The upstream image hardcodes `--port=8000` in its entrypoint, which Render cannot
# route (Render injects $PORT). This wrapper keeps the same image and scanner
# configuration as the Kubernetes deployment (k8s/09-llm-guard.yaml) but replaces
# the entrypoint with one that binds $PORT.
#
# scanners.yml is mounted at CONFIG_FILE. AUTH_TOKEN is interpolated into the config
# (${AUTH_TOKEN:}); set it on the service so the endpoint is not open to the internet.
# ─────────────────────────────────────────────────────────────────────────────
FROM laiyer/llm-guard-api@sha256:bea3efb1220ad18149b73de625c55e6d835bf8b45023a089a3762012a86550ba

ENV CONFIG_FILE=/app/conf/scanners.yml \
    PYTHONPATH=/home/user/app

COPY deploy/llm-guard/scanners.yml /app/conf/scanners.yml

# The base image's ENTRYPOINT (./entrypoint.sh) ignores arguments and pins port 8000,
# so it is cleared here and replaced with the same uvicorn command, bound to $PORT.
ENTRYPOINT []
CMD ["sh", "-c", "exec uvicorn app.app:create_app --host=0.0.0.0 --port=${PORT:-8000} --workers=${APP_WORKERS:-1} --forwarded-allow-ips=* --proxy-headers --timeout-keep-alive=2"]

EXPOSE 8000
