"""
AI Registry — Metadata-Only Audit Logger for LiteLLM

Writes one row per request to ai_registry.audit_log: token counts, cost, latency, HTTP
status, guardrail outcomes and attribution (team, pseudonymous end user, AI system).
It never stores prompt or response text.
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

# guardrail_status values written by the guardrails (see llm_guard_guardrail._record_block)
STATUS_BLOCKED = "guardrail_intervened"  # a scanner blocked the request or its response
STATUS_FLAGGED = "guardrail_flagged"     # a monitor-only scanner flagged it; NOT blocked


def _clip(value, limit):
    """Truncate to the column width; empty values become NULL."""
    return str(value)[:limit] if value else None


def _as_http_status(value):
    """Return `value` as an HTTP status code (100-599), or None when it is not one."""
    try:
        status = int(value)
    except (TypeError, ValueError):
        return None
    return status if 100 <= status <= 599 else None


def _resolve_status_code(slo, exception, is_error, identified=True):
    """HTTP status of the logged request.

    Successful calls are 200. A failure carries its real status in a different place
    depending on where it was raised: guardrail blocks are HTTPExceptions (`status_code`),
    proxy auth / RBAC errors expose a string `code`, and LiteLLM mirrors it in
    `error_information.error_code`. Read all of them instead of defaulting to 500, so a
    401/403/429 is not recorded as a server error.

    A failure that carries no status at all is ambiguous. When the request never got an
    authenticated identity (`identified` is False) it was rejected at the auth gate, where
    LiteLLM raises a bare `Exception("No api key passed in.")` and only afterwards turns it
    into the 401 the client sees, so it is recorded as 401. Otherwise it is a genuine 500.
    """
    if not is_error:
        return _as_http_status(slo.get("status")) or 200
    error_info = slo.get("error_information") or {}
    for candidate in (
        getattr(exception, "status_code", None),
        error_info.get("error_code"),
        getattr(exception, "code", None),
    ):
        status = _as_http_status(candidate)
        if status:
            return status
    return 500 if identified or exception is None else 401


def _summarize_guardrails(guardrail_info):
    """Reduce guardrail results to what the audit row stores.

    Security scanners are split by outcome: `blocked` scanners stopped the request, while
    `flagged` scanners are monitor-only (advisory) and let it through. Keeping them apart
    stops advisory hits from inflating the "blocked" counters.
    """
    pii_entities, blocked, flagged = [], [], []
    security_blocked = security_flagged = False
    for entry in guardrail_info or []:
        if not isinstance(entry, dict):
            continue
        for entity in entry.get("masked_entity_count") or {}:
            if entity not in pii_entities:
                pii_entities.append(entity)

        name = (entry.get("guardrail_name") or "").lower()
        if "llm-guard" not in name and "llm_guard" not in name:
            continue
        response = entry.get("guardrail_response")
        scanners = (response.get("scanners_triggered") if isinstance(response, dict) else None) or []
        status = entry.get("guardrail_status")
        if status == STATUS_BLOCKED:
            security_blocked = True
            blocked.extend(s for s in scanners if s not in blocked)
        elif status == STATUS_FLAGGED:
            security_flagged = True
            flagged.extend(s for s in scanners if s not in flagged)

    return {
        "pii_triggered": bool(pii_entities),
        "pii_entities": pii_entities,
        "security_triggered": security_blocked,
        "security_scanners": blocked,
        "security_flagged": security_flagged,
        "security_flagged_scanners": flagged,
    }


class RegistryLogger(CustomLogger):
    # Attribution is deterministic: a request is attributed to a registered AI system only
    # when that is unambiguous. Either the caller named a system that belongs to its OWN team
    # (request metadata `ai_system`, matched by name or id), or the team has exactly one
    # registered system. Otherwise ai_system_id stays NULL rather than guessing, and a
    # system named by a caller of a different team is never accepted.
    _INSERT_SQL = """
        INSERT INTO ai_registry.audit_log (
            request_id, litellm_team_id, litellm_key_alias, end_user, model_requested, model_used,
            prompt_tokens, completion_tokens, total_tokens, response_cost_usd, latency_ms,
            status_code, guardrail_pii_triggered, guardrail_pii_entities,
            guardrail_security_triggered, guardrail_security_scanners,
            guardrail_security_flagged, guardrail_security_flagged_scanners,
            error_message, ai_system_id
        ) VALUES (
            %(request_id)s,
            -- Used again in the attribution subquery below; casting both uses to text gives
            -- PostgreSQL a single inferred parameter type (varchar vs text is otherwise ambiguous).
            %(litellm_team_id)s::text,
            %(litellm_key_alias)s, %(end_user)s,
            %(model_requested)s, %(model_used)s,
            %(prompt_tokens)s, %(completion_tokens)s, %(total_tokens)s, %(response_cost_usd)s,
            %(latency_ms)s, %(status_code)s, %(guardrail_pii_triggered)s, %(guardrail_pii_entities)s,
            %(guardrail_security_triggered)s, %(guardrail_security_scanners)s,
            %(guardrail_security_flagged)s, %(guardrail_security_flagged_scanners)s,
            %(error_message)s,
            (
                SELECT s.id FROM ai_registry.ai_systems s
                WHERE s.litellm_team_id = %(litellm_team_id)s::text
                  AND CASE
                        WHEN %(ai_system)s::text IS NOT NULL
                          THEN (s.id::text = %(ai_system)s::text OR s.system_name = %(ai_system)s::text)
                        ELSE (SELECT count(*) FROM ai_registry.ai_systems t
                              WHERE t.litellm_team_id = s.litellm_team_id) = 1
                      END
                LIMIT 1
            )
        )
    """

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
        # Pseudonymous caller id the Backend sends as the x-litellm-end-user-id header.
        end_user = slo.get("end_user") or metadata.get("user_api_key_end_user_id") or lp_metadata.get("user_api_key_end_user_id") or ""
        # AI system the caller declared via request metadata `ai_system`; it is resolved to a
        # registered system (within the caller's team) when the row is written.
        requester = metadata.get("requester_metadata")
        ai_system = (requester.get("ai_system") if isinstance(requester, dict) else None) or lp_metadata.get("ai_system") or ""
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

        # Authenticated principals always carry a team, key alias or user id; an auth-gate
        # rejection (missing/malformed key) never does. The key hash cannot tell them apart:
        # a malformed header is echoed back there verbatim.
        identified = bool(
            team_id
            or key_alias
            or metadata.get("user_api_key_user_id")
            or lp_metadata.get("user_api_key_user_id")
        )
        status_code = _resolve_status_code(slo, kwargs.get("exception"), is_error, identified)

        # LiteLLM exposes guardrail results at the top level of the standard logging payload.
        guardrail_info = (
            slo.get("guardrail_information")
            or metadata.get("standard_logging_guardrail_information")
            or lp_metadata.get("standard_logging_guardrail_information")
            or []
        )
        guardrails = _summarize_guardrails(guardrail_info)

        error_msg = None
        if is_error:
            exc = kwargs.get("exception", None)
            if exc:
                error_msg = f"{type(exc).__name__} (HTTP {status_code})"

        return {
            "request_id": _clip(request_id, 100),
            "litellm_team_id": _clip(team_id, 100),
            "litellm_key_alias": _clip(key_alias, 100),
            "end_user": _clip(end_user, 100),
            "ai_system": _clip(ai_system, 255),
            "model_requested": _clip(model_requested, 100),
            "model_used": _clip(model_used, 100),
            "prompt_tokens": usage["prompt_tokens"],
            "completion_tokens": usage["completion_tokens"],
            "total_tokens": usage["total_tokens"],
            "response_cost_usd": float(cost),
            "latency_ms": latency_ms,
            "status_code": status_code,
            "guardrail_pii_triggered": guardrails["pii_triggered"],
            "guardrail_pii_entities": guardrails["pii_entities"],
            "guardrail_security_triggered": guardrails["security_triggered"],
            "guardrail_security_scanners": guardrails["security_scanners"],
            "guardrail_security_flagged": guardrails["security_flagged"],
            "guardrail_security_flagged_scanners": guardrails["security_flagged_scanners"],
            "error_message": _clip(error_msg, 500),
        }

    async def _write_audit_log(self, data):
        if not self._db_url or psycopg is None:
            return
        params = {
            **data,
            # JSONB columns take JSON text.
            "guardrail_pii_entities": json.dumps(data["guardrail_pii_entities"]),
            "guardrail_security_scanners": json.dumps(data["guardrail_security_scanners"]),
            "guardrail_security_flagged_scanners": json.dumps(data["guardrail_security_flagged_scanners"]),
        }
        try:
            async with await psycopg.AsyncConnection.connect(self._db_url) as aconn:
                async with aconn.cursor() as cur:
                    await cur.execute(self._INSERT_SQL, params)
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
