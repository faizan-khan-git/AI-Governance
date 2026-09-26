"""
LLM Guard Security Guardrail for LiteLLM.

Bridges the LiteLLM proxy to the in-cluster LLM Guard API server. It scans the
prompt on the way in (prompt injection, jailbreak, toxicity, banned topics) and
the model response on the way out (toxicity, sensitive-data leaks, banned
topics), and hard-blocks the request with HTTP 400 when any scanner flags the
content.

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


class LLMGuardGuardrail(CustomGuardrail):
    def __init__(self, **kwargs):
        self.api_base = (
            kwargs.pop("api_base", None)
            or os.getenv("LLM_GUARD_API_BASE")
            or "http://llm-guard-service.litellm.svc.cluster.local:8000"
        ).rstrip("/")
        self.api_key = kwargs.pop("api_key", None) or os.getenv("LLM_GUARD_API_KEY", "")
        self.timeout = float(os.getenv("LLM_GUARD_TIMEOUT", "30"))
        # Security-first default: if the scanner service is unreachable, block the
        # inbound request rather than letting unscanned content reach the model.
        self.fail_closed = os.getenv("LLM_GUARD_FAIL_CLOSED", "true").lower() == "true"
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

    async def _post(self, path, payload):
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.api_base}{path}", headers=self._headers(), json=payload
            )
            resp.raise_for_status()
            return resp.json()

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

        if not result.get("is_valid", True):
            failed = self._failed_scanners(result.get("scanners", {}))
            verbose_proxy_logger.warning(
                "LLM Guard BLOCKED input. scanners_triggered=%s", failed
            )
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
                # Output scan failures fail open: the response already exists and
                # blocking on a transient scanner outage would degrade availability.
                verbose_proxy_logger.warning("LLM Guard output scan error: %s", exc)
                continue

            if not result.get("is_valid", True):
                failed = self._failed_scanners(result.get("scanners", {}))
                verbose_proxy_logger.warning(
                    "LLM Guard BLOCKED output. scanners_triggered=%s", failed
                )
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
