"""
AI Registry — Metadata-Only Audit Logger for LiteLLM
"""
import os
import json
import traceback
from datetime import datetime
from litellm.integrations.custom_logger import CustomLogger

# psycopg is optional: if the driver is missing from the image, audit logging
# degrades to a safe no-op instead of breaking proxy startup.
try:
    import psycopg
except Exception:
    psycopg = None

class RegistryLogger(CustomLogger):
    def __init__(self):
        super().__init__()
        raw_url = os.environ.get("DATABASE_URL", "").replace("postgres://", "postgresql://")
        # Strip Prisma-specific query params (e.g. ?connection_limit=) that psycopg rejects
        if "?" in raw_url:
            raw_url = raw_url.split("?")[0]
        self._db_url = raw_url

    def _extract_metadata(self, kwargs, response_obj, is_error=False):
        slo = kwargs.get("standard_logging_object", {}) or {}
        metadata = slo.get("metadata", {}) or {}
        lp_metadata = (kwargs.get("litellm_params", {}) or {}).get("metadata", {}) or {}

        request_id = slo.get("id") or slo.get("trace_id") or metadata.get("trace_id", "")
        team_id = metadata.get("user_api_key_team_id", "") or lp_metadata.get("user_api_key_team_id", "") or metadata.get("user_team", "") or ""
        key_alias = metadata.get("user_api_key_alias", "") or metadata.get("user_api_key_key_name", "") or metadata.get("user_key_alias", "") or ""
        model_requested = slo.get("model_group", "") or kwargs.get("model", "")
        model_used = slo.get("model", "") or kwargs.get("model", "")

        usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        if response_obj and hasattr(response_obj, "usage") and response_obj.usage:
            u = response_obj.usage
            usage["prompt_tokens"] = getattr(u, "prompt_tokens", 0) or 0
            usage["completion_tokens"] = getattr(u, "completion_tokens", 0) or 0
            usage["total_tokens"] = getattr(u, "total_tokens", 0) or 0
        else:
            usage["prompt_tokens"] = slo.get("prompt_tokens", 0) or 0
            usage["completion_tokens"] = slo.get("completion_tokens", 0) or 0
            usage["total_tokens"] = slo.get("total_tokens", 0) or 0

        cost = kwargs.get("response_cost", 0) or slo.get("response_cost", 0) or 0

        latency_ms = 0
        start, end = kwargs.get("start_time"), kwargs.get("end_time")
        if isinstance(start, datetime) and isinstance(end, datetime):
            latency_ms = int((end - start).total_seconds() * 1000)
        if not latency_ms:
            rt = slo.get("response_time", 0) or 0
            latency_ms = int(rt * 1000) if rt else 0

        # LiteLLM status field returns 'success'/'failure' strings, not HTTP codes
        raw_status = slo.get("status", "")
        if isinstance(raw_status, int):
            status_code = raw_status
        elif str(raw_status).isdigit():
            status_code = int(raw_status)
        elif raw_status == "success":
            status_code = 200
        else:
            status_code = 500 if is_error else 200
        # Prefer the real HTTP status of the failure (e.g. 400 guardrail block, 429 rate limit).
        exc_status = getattr(kwargs.get("exception"), "status_code", None) if is_error else None
        if str(exc_status).isdigit():
            status_code = int(exc_status)

        guardrail_pii_triggered, guardrail_pii_entities = False, []
        guardrail_security_triggered, guardrail_security_scanners = False, []
        # LiteLLM exposes guardrail results at the top level of the standard logging payload.
        guardrail_info = (
            slo.get("guardrail_information")
            or metadata.get("standard_logging_guardrail_information")
            or lp_metadata.get("standard_logging_guardrail_information")
            or []
        )
        for g in guardrail_info:
            if not isinstance(g, dict): continue
            name = (g.get("guardrail_name") or "").lower()
            masked = g.get("masked_entity_count", {}) or {}
            if masked:
                guardrail_pii_triggered = True
                guardrail_pii_entities.extend(e for e in masked if e not in guardrail_pii_entities)
            if ("llm-guard" in name or "llm_guard" in name) and g.get("guardrail_status") in ("guardrail_intervened", "guardrail_flagged"):
                guardrail_security_triggered = True
                g_response = g.get("guardrail_response")
                if isinstance(g_response, dict):
                    guardrail_security_scanners.extend(g_response.get("scanners_triggered") or [])

        error_msg = None
        if is_error:
            exc = kwargs.get("exception", None)
            if exc:
                error_msg = str(type(exc).__name__)
                if hasattr(exc, "status_code"): error_msg += f" (HTTP {exc.status_code})"

        return {
            "request_id": request_id[:100] if request_id else None,
            "litellm_team_id": team_id[:100] if team_id else None,
            "litellm_key_alias": key_alias[:100] if key_alias else None,
            "model_requested": model_requested[:100] if model_requested else None,
            "model_used": model_used[:100] if model_used else None,
            "prompt_tokens": usage["prompt_tokens"],
            "completion_tokens": usage["completion_tokens"],
            "total_tokens": usage["total_tokens"],
            "response_cost_usd": float(cost),
            "latency_ms": latency_ms,
            "status_code": status_code,
            "guardrail_pii_triggered": guardrail_pii_triggered,
            "guardrail_pii_entities": guardrail_pii_entities,
            "guardrail_security_triggered": guardrail_security_triggered,
            "guardrail_security_scanners": guardrail_security_scanners,
            "error_message": error_msg[:500] if error_msg else None,
        }

    async def _write_audit_log(self, data):
        if not self._db_url or psycopg is None:
            return
        try:
            async with await psycopg.AsyncConnection.connect(self._db_url) as aconn:
                async with aconn.cursor() as cur:
                    await cur.execute(
                        """
                        INSERT INTO ai_registry.audit_log (
                            request_id, litellm_team_id, litellm_key_alias, model_requested, model_used,
                            prompt_tokens, completion_tokens, total_tokens, response_cost_usd, latency_ms,
                            status_code, guardrail_pii_triggered, guardrail_pii_entities,
                            guardrail_security_triggered, guardrail_security_scanners, error_message, ai_system_id
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            (SELECT id FROM ai_registry.ai_systems WHERE litellm_team_id = %s LIMIT 1)
                        )
                        """,
                        (
                            data["request_id"], data["litellm_team_id"], data["litellm_key_alias"],
                            data["model_requested"], data["model_used"], data["prompt_tokens"],
                            data["completion_tokens"], data["total_tokens"], data["response_cost_usd"],
                            data["latency_ms"], data["status_code"], data["guardrail_pii_triggered"],
                            json.dumps(data["guardrail_pii_entities"]), data["guardrail_security_triggered"],
                            json.dumps(data["guardrail_security_scanners"]), data["error_message"],
                            data["litellm_team_id"]
                        )
                    )
        except Exception:
            traceback.print_exc()

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        try:
            await self._write_audit_log(self._extract_metadata(kwargs, response_obj, is_error=False))
        except Exception:
            traceback.print_exc()

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        try:
            await self._write_audit_log(self._extract_metadata(kwargs, response_obj, is_error=True))
        except Exception:
            traceback.print_exc()

proxy_handler_instance = RegistryLogger()
