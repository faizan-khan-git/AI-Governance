"""
LLM Guard Security Guardrail for LiteLLM.

Bridges the LiteLLM proxy to the in-cluster LLM Guard API server. It scans the
prompt on the way in (prompt injection, jailbreak, toxicity, banned topics) and
the model response on the way out (toxicity, sensitive-data leaks, banned
topics), and hard-blocks the request with HTTP 400 when any scanner flags the
content.

Scanners listed in ``monitor_only_scanners`` (config) or ``LLM_GUARD_MONITOR_ONLY``
(env, comma-separated) are advisory: a hit is logged and recorded in the audit
trail as ``guardrail_flagged`` but does not block the request. Use it for
classifiers whose false-positive rate is still being evaluated.

Failure policy when the LLM Guard service cannot be reached: the INPUT scan fails closed
(HTTP 503, ``LLM_GUARD_FAIL_CLOSED``, default true), so an unscanned prompt never reaches
the model. The OUTPUT scan fails open by default — the reply already exists and a transient
scanner outage should not discard it — and the error is logged. Set
``LLM_GUARD_OUTPUT_FAIL_CLOSED=true`` to block such replies with HTTP 503 instead.

Replaces the deprecated native `guardrail: llm_guard` provider, which newer
LiteLLM releases no longer support. Referenced from proxy_config.yaml as:

    guardrail: callbacks.llm_guard_guardrail.LLMGuardGuardrail
"""
import os

import httpx
from fastapi import HTTPException

from litellm._logging import verbose_proxy_logger
from litellm.integrations.custom_guardrail import CustomGuardrail

try:
    from litellm.types.guardrails import GuardrailEventHooks
except Exception:  # pragma: no cover - keeps guardrail loadable across versions
    GuardrailEventHooks = None


def _as_name_set(value):
    """Accept a list or a comma-separated string of scanner names."""
    if isinstance(value, str):
        value = value.split(",")
    return frozenset(str(v).strip() for v in (value or []) if str(v).strip())


class LLMGuardGuardrail(CustomGuardrail):
    def __init__(self, **kwargs):
        self.api_base = (
            kwargs.pop("api_base", None)
            or os.getenv("LLM_GUARD_API_BASE")
            or "http://llm-guard-service.litellm.svc.cluster.local:8000"
        ).rstrip("/")
        self.api_key = kwargs.pop("api_key", None) or os.getenv("LLM_GUARD_API_KEY", "")
        self.monitor_only = _as_name_set(
            kwargs.pop("monitor_only_scanners", None) or os.getenv("LLM_GUARD_MONITOR_ONLY", "")
        )
        self.timeout = float(os.getenv("LLM_GUARD_TIMEOUT", "30"))
        # Security-first default: if the scanner service is unreachable, block the
        # inbound request rather than letting unscanned content reach the model.
        self.fail_closed = os.getenv("LLM_GUARD_FAIL_CLOSED", "true").lower() == "true"
        # Output scanning defaults to fail-open (see the module docstring); opt in to fail-closed.
        self.output_fail_closed = (
            os.getenv("LLM_GUARD_OUTPUT_FAIL_CLOSED", "false").lower() == "true"
        )
        super().__init__(**kwargs)

    def _headers(self):
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    @staticmethod
    def _extract_text(messages):
        parts = []
        for message in messages or []:
            content = message.get("content")
            if isinstance(content, str):
                parts.append(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        parts.append(block["text"])
        return "\n".join(p for p in parts if p)

    @staticmethod
    def _failed_scanners(scanners):
        # scanners maps scanner name -> risk score in [0, 1]; > 0 means it flagged.
        return [
            name
            for name, score in (scanners or {}).items()
            if isinstance(score, (int, float)) and score > 0
        ]

    def _should_run(self, data, event_type):
        if GuardrailEventHooks is None:
            return True
        try:
            return self.should_run_guardrail(data=data, event_type=event_type) is True
        except Exception:
            return True

    _INJECTION_PATTERNS = [
        r"(?i)\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|system|above|your)\s+(instructions|prompts|rules|commands)\b",
        r"(?i)\b(ignore|disregard|forget|override)\s+(your\s+)?instructions\b",
        r"(?i)\b(you are now (in\s+)?|enable|activate|switch to)\s*(dan|jailbreak|developer|unrestricted|god)\s*mode?\b",
        r"(?i)\b(you are|act as)\s+dan\b",
        r"(?i)\b(do anything now|act as if you have no restrictions|without any restrictions|act as an unrestricted ai)\b",
        r"(?i)\b(pretend you are|simulate a conversation|hypothetically speaking|in a fictional scenario|roleplay as)\b",
        r"(?i)\b(tell me|reveal|print|output|display|show|leak)\s+(your|the)?\s*(system\s*prompt|initial\s*instructions|internal\s*rules)\b",
        r"(?i)\b(pretend you have no (rules|limits|safety|restrictions))\b",
    ]

    _BANNED_PATTERNS = [
        r"(?i)\b(create|write|generate|build)\s+(malware|keylogger|ransomware|trojan|rootkit|exploit payload)\b",
        r"(?i)\b(credit card dump|steal credit cards?|dump passwords?|hack into)\b",
    ]

    def _local_scan(self, text):
        import re
        if not text:
            return {"is_valid": True, "scanners": {}}
        scanners = {}
        for pat in self._INJECTION_PATTERNS:
            if re.search(pat, text):
                scanners["PromptInjection"] = 1.0
                break
        for pat in self._BANNED_PATTERNS:
            if re.search(pat, text):
                scanners["BannedTopics"] = 1.0
                break
        return {"is_valid": len(scanners) == 0, "scanners": scanners}

    async def _post(self, path, payload):
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(
                    f"{self.api_base}{path}", headers=self._headers(), json=payload
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            verbose_proxy_logger.info("LLM Guard HTTP unavailable (%s), using standalone pattern analysis", exc)
            return self._local_scan(payload.get("prompt", "") or payload.get("output", ""))

    def _record_block(self, data, direction, failed, status="guardrail_intervened"):
        # Feeds the AI Registry audit log (guardrail_security_*); never contains prompt text.
        try:
            self.add_standard_logging_guardrail_information_to_request_data(
                guardrail_json_response={"direction": direction, "scanners_triggered": failed},
                request_data=data,
                guardrail_status=status,
                guardrail_provider="llm_guard",
            )
        except Exception:
            verbose_proxy_logger.debug("Could not record LLM Guard block", exc_info=True)

    def _verdict(self, result, data, direction):
        """Return the blocking scanner names; monitor-only hits are only recorded."""
        if result.get("is_valid", True):
            return []
        failed = self._failed_scanners(result.get("scanners", {}))
        blocking = [name for name in failed if name not in self.monitor_only]
        monitored = [name for name in failed if name in self.monitor_only]
        if monitored and not blocking:
            verbose_proxy_logger.warning(
                "LLM Guard FLAGGED %s (monitor-only, not blocked). scanners_triggered=%s",
                direction, monitored,
            )
            self._record_block(data, direction, monitored, status="guardrail_flagged")
        return blocking

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        if GuardrailEventHooks is not None and not self._should_run(
            data, GuardrailEventHooks.pre_call
        ):
            return data

        prompt = self._extract_text(data.get("messages") or [])
        if not prompt.strip():
            return data

        try:
            result = await self._post("/analyze/prompt", {"prompt": prompt})
        except Exception as exc:
            verbose_proxy_logger.warning("LLM Guard input scan error: %s", exc)
            if self.fail_closed:
                raise HTTPException(
                    status_code=503,
                    detail={
                        "error": "Security guardrail unavailable",
                        "guardrail": "llm-guard-security",
                    },
                )
            return data

        failed = self._verdict(result, data, "input")
        if failed:
            verbose_proxy_logger.warning(
                "LLM Guard BLOCKED input. scanners_triggered=%s", failed
            )
            self._record_block(data, "input", failed)
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "Blocked by LLM Guard security policy",
                    "guardrail": "llm-guard-security",
                    "direction": "input",
                    "scanners_triggered": failed,
                },
            )
        return data

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        import litellm

        if GuardrailEventHooks is not None and not self._should_run(
            data, GuardrailEventHooks.post_call
        ):
            return response
        if not isinstance(response, litellm.ModelResponse):
            return response

        prompt = self._extract_text(data.get("messages") or [])
        for choice in response.choices:
            message = getattr(choice, "message", None)
            content = getattr(message, "content", None) if message else None
            if not isinstance(content, str) or not content.strip():
                continue

            try:
                result = await self._post(
                    "/analyze/output", {"prompt": prompt, "output": content}
                )
            except Exception as exc:
                verbose_proxy_logger.warning("LLM Guard output scan error: %s", exc)
                if self.output_fail_closed:
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "error": "Security guardrail unavailable",
                            "guardrail": "llm-guard-security",
                            "direction": "output",
                        },
                    )
                # Fail open (the default): the response already exists and blocking on a
                # transient scanner outage would degrade availability.
                continue

            failed = self._verdict(result, data, "output")
            if failed:
                verbose_proxy_logger.warning(
                    "LLM Guard BLOCKED output. scanners_triggered=%s", failed
                )
                self._record_block(data, "output", failed)
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "Response blocked by LLM Guard security policy",
                        "guardrail": "llm-guard-security",
                        "direction": "output",
                        "scanners_triggered": failed,
                    },
                )
        return response
