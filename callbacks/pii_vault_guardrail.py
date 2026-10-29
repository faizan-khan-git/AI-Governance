"""
PII Vault Guardrail for LiteLLM — reversible Presidio masking backed by Redis.

Request path (mode "pre_call", declared FIRST in proxy_config.yaml):
  1. Presidio Analyzer detects PII in every text part of the request.
  2. Each distinct value is assigned a vault token: [PERSON_1], [EMAIL_ADDRESS_1], ...
  3. Presidio Anonymizer replaces the detected spans with those tokens.
  4. The token -> original value map is written to a per-request Redis hash
     (pii_vault:<id>) with a short TTL. Only the opaque vault id travels with
     the request, so the LLM, logs, and caches never see the raw PII.

Response path (mode "post_call", declared LAST so it runs after the LLM Guard
output scan):
  5. The vault is read back from Redis and every token in the model response is
     replaced with its original value.
  6. The vault entry is deleted (single use). Failed requests purge it in
     async_post_call_failure_hook; the TTL is the final safety net.

Referenced from proxy_config.yaml as:

    guardrail: callbacks.pii_vault_guardrail.PIIVaultGuardrail
"""
import asyncio
import json
import os
import re
import secrets
import time

import httpx
from fastapi import HTTPException

from litellm._logging import verbose_proxy_logger
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.types.guardrails import GuardrailEventHooks

try:
    import redis.asyncio as aioredis
except Exception:  # pragma: no cover - surfaces as "PII guardrail unavailable" per request
    aioredis = None

VAULT_KEY_PREFIX = "pii_vault:"
VAULT_ID_FIELD = "pii_vault_id"
_VAULT_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


async def _gather_all(*awaitables):
    """Await every call, then raise the first failure (no orphaned in-flight requests)."""
    results = await asyncio.gather(*awaitables, return_exceptions=True)
    for result in results:
        if isinstance(result, BaseException):
            raise result
    return results


class PIIVaultGuardrail(CustomGuardrail):
    def __init__(self, **kwargs):
        self.analyzer_api_base = (
            kwargs.pop("presidio_analyzer_api_base", None)
            or os.getenv("PRESIDIO_ANALYZER_API_BASE")
            or "http://presidio-analyzer-service.litellm.svc.cluster.local:5001"
        ).rstrip("/")
        self.anonymizer_api_base = (
            kwargs.pop("presidio_anonymizer_api_base", None)
            or os.getenv("PRESIDIO_ANONYMIZER_API_BASE")
            or "http://presidio-anonymizer-service.litellm.svc.cluster.local:5002"
        ).rstrip("/")
        self.language = kwargs.pop("presidio_language", None) or "en"
        # Terms the NER model wrongly treats as PII (e.g. "Kubernetes" -> LOCATION). They are
        # excluded from detection by exact, case-sensitive match on the whole detected span.
        # Only list terms that can never be personal data; names and surnames do not belong here.
        self.allow_list = [
            str(term) for term in (kwargs.pop("presidio_allow_list", None) or []) if str(term).strip()
        ]
        # Entity -> action ("MASK" | "BLOCK"); keys/values may arrive as str enums.
        self.entity_actions = {
            str(getattr(entity, "value", entity)): str(getattr(action, "value", action)).upper()
            for entity, action in (kwargs.pop("pii_entities_config", None) or {}).items()
        }
        self.score_thresholds = {
            str(getattr(entity, "value", entity)): float(score)
            for entity, score in (kwargs.pop("presidio_score_thresholds", None) or {}).items()
        }
        self.vault_ttl_seconds = int(
            kwargs.pop("vault_ttl_seconds", None) or os.getenv("PII_VAULT_TTL_SECONDS", "300")
        )
        self.redis_url = kwargs.pop("redis_url", None) or os.getenv("REDIS_URL", "")
        self.http_timeout = float(os.getenv("PRESIDIO_TIMEOUT", "15"))
        self._redis = None
        super().__init__(**kwargs)

    # ── Redis / Memory vault ─────────────────────────────────────────────────
    _mem_vault = {}

    def _redis_client(self):
        if self._redis is None:
            if aioredis is None or not self.redis_url:
                return None
            try:
                self._redis = aioredis.from_url(
                    self.redis_url,
                    decode_responses=True,
                    socket_timeout=5,
                    socket_connect_timeout=5,
                )
            except Exception:
                self._redis = None
        return self._redis

    async def _vault_store(self, vault_id, vault):
        key = VAULT_KEY_PREFIX + vault_id
        client = self._redis_client()
        if client is not None:
            try:
                async with client.pipeline(transaction=True) as pipe:
                    await pipe.hset(key, mapping=vault).expire(key, self.vault_ttl_seconds).execute()
                return
            except Exception as exc:
                verbose_proxy_logger.warning("Redis vault store failed, falling back to memory: %s", exc)

        # In-memory fallback
        now = time.time()
        # Clean expired
        expired = [k for k, v in self._mem_vault.items() if now > v.get("_exp", 0)]
        for k in expired:
            self._mem_vault.pop(k, None)
        self._mem_vault[vault_id] = {**vault, "_exp": now + self.vault_ttl_seconds}

    async def _vault_take(self, vault_id):
        key = VAULT_KEY_PREFIX + vault_id
        client = self._redis_client()
        if client is not None:
            try:
                async with client.pipeline(transaction=True) as pipe:
                    vault, _ = await pipe.hgetall(key).delete(key).execute()
                if vault:
                    return vault
            except Exception as exc:
                verbose_proxy_logger.warning("Redis vault take failed, falling back to memory: %s", exc)

        # In-memory fallback
        item = self._mem_vault.pop(vault_id, None)
        if item:
            item.pop("_exp", None)
            return item
        return {}

    @staticmethod
    def _pop_vault_id(data):
        metadata = data.get("metadata") if isinstance(data, dict) else None
        vault_id = metadata.pop(VAULT_ID_FIELD, None) if isinstance(metadata, dict) else None
        if isinstance(vault_id, str) and _VAULT_ID_PATTERN.match(vault_id):
            return vault_id
        return None

    # ── Presidio / Regex Analysis ───────────────────────────────────────────
    _REGEX_PATTERNS = {
        "EMAIL_ADDRESS": re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),
        "PHONE_NUMBER": re.compile(r'\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'),
        "CREDIT_CARD": re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'),
        "US_SSN": re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
        "IP_ADDRESS": re.compile(r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b'),
        "IN_AADHAAR": re.compile(r'\b\d{4}\s?\d{4}\s?\d{4}\b'),
        "IN_PAN": re.compile(r'\b[A-Z]{5}[0-9]{4}[A-Z]\b'),
    }

    def _local_regex_analyze(self, text):
        results = []
        for entity, pattern in self._REGEX_PATTERNS.items():
            for m in pattern.finditer(text):
                val = m.group(0)
                if val in self.allow_list:
                    continue
                results.append({
                    "entity_type": entity,
                    "start": m.start(),
                    "end": m.end(),
                    "score": 0.95,
                })
        return results

    async def _analyze(self, client, text):
        try:
            payload = {"text": text, "language": self.language}
            if self.entity_actions:
                payload["entities"] = list(self.entity_actions)
            if self.allow_list:
                payload["allow_list"] = self.allow_list
            resp = await client.post(f"{self.analyzer_api_base}/analyze", json=payload)
            resp.raise_for_status()
            results = resp.json()
            if isinstance(results, list):
                return results
        except Exception as exc:
            verbose_proxy_logger.info("Presidio Analyzer unavailable (%s), using standalone pattern analysis", exc)
        return self._local_regex_analyze(text)

    async def _anonymize(self, client, text, analyzer_results, operators):
        try:
            resp = await client.post(
                f"{self.anonymizer_api_base}/anonymize",
                json={"text": text, "analyzer_results": analyzer_results, "anonymizers": operators},
            )
            resp.raise_for_status()
            masked = resp.json().get("text")
            if isinstance(masked, str):
                return masked
        except Exception as exc:
            verbose_proxy_logger.info("Presidio Anonymizer unavailable (%s), performing local span masking", exc)

        # Local span replacement fallback
        sorted_spans = sorted(analyzer_results, key=lambda s: -s.get("start", 0))
        out = text
        for span in sorted_spans:
            s_start = span.get("start")
            s_end = span.get("end")
            ent = span.get("entity_type")
            new_val = operators.get(ent, {}).get("new_value")
            if new_val and s_start is not None and s_end is not None:
                out = out[:s_start] + new_val + out[s_end:]
        return out

    def _select_spans(self, results):
        """Drop detections below their score threshold, then keep the strongest non-overlapping spans."""
        candidates = []
        for item in results:
            if not isinstance(item, dict):
                continue
            entity, start, end = item.get("entity_type"), item.get("start"), item.get("end")
            score = float(item.get("score") or 0.0)
            if not isinstance(entity, str) or not isinstance(start, int) or not isinstance(end, int) or end <= start:
                continue
            if score < self.score_thresholds.get(entity, self.score_thresholds.get("ALL", 0.0)):
                continue
            candidates.append((entity, start, end, score))

        selected = []
        for cand in sorted(candidates, key=lambda c: (-c[3], c[1] - c[2], c[1])):
            if all(cand[2] <= kept[1] or cand[1] >= kept[2] for kept in selected):
                selected.append(cand)
        return sorted(selected, key=lambda c: c[1])

    def _plan_masking(self, segments, detections):
        """Assign request-wide tokens (same value -> same token) and build per-segment anonymizer input."""
        vault, counts, plans = {}, {}, []
        token_for_value, sequence = {}, {}
        for segment, results in zip(segments, detections):
            text = segment[2]
            analyzer_results, operators = [], {}
            for entity, start, end, score in self._select_spans(results):
                value = text[start:end]
                token = token_for_value.get((entity, value))
                if token is None:
                    sequence[entity] = sequence.get(entity, 0) + 1
                    token = f"[{entity}_{sequence[entity]}]"
                    token_for_value[(entity, value)] = token
                    vault[token] = value
                counts[entity] = counts.get(entity, 0) + 1
                # A unique entity_type per token lets the Anonymizer apply one replace operator per value.
                operators[token[1:-1]] = {"type": "replace", "new_value": token}
                analyzer_results.append({"entity_type": token[1:-1], "start": start, "end": end, "score": score})
            if analyzer_results:
                plans.append((segment, analyzer_results, operators))
        return vault, counts, plans

    @staticmethod
    def _text_segments(messages):
        """Return (message_index, block_index | None, text) for every text part of the request."""
        segments = []
        for m_idx, message in enumerate(messages):
            if not isinstance(message, dict):
                continue
            content = message.get("content")
            if isinstance(content, str):
                if content.strip():
                    segments.append((m_idx, None, content))
            elif isinstance(content, list):
                for b_idx, block in enumerate(content):
                    if isinstance(block, dict) and isinstance(block.get("text"), str) and block["text"].strip():
                        segments.append((m_idx, b_idx, block["text"]))
        return segments

    def _record(self, data, status, started, counts, response=None):
        ended = time.time()
        try:
            self.add_standard_logging_guardrail_information_to_request_data(
                guardrail_json_response=response if response is not None else {"masked_entity_count": counts},
                request_data=data,
                guardrail_status=status,
                start_time=started,
                end_time=ended,
                duration=ended - started,
                masked_entity_count=counts,
                guardrail_provider="presidio",
            )
        except Exception:
            verbose_proxy_logger.debug("PII vault: could not record guardrail information", exc_info=True)

    # ── Hooks ────────────────────────────────────────────────────────────────
    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        if not isinstance(data, dict):
            return data
        metadata = data.get("metadata")
        if not isinstance(metadata, dict):
            metadata = data["metadata"] = {}
        # Vault ids are only ever minted below; never trust one supplied by the client.
        metadata.pop(VAULT_ID_FIELD, None)

        if self.should_run_guardrail(data=data, event_type=GuardrailEventHooks.pre_call) is not True:
            return data
        messages = data.get("messages")
        segments = self._text_segments(messages) if isinstance(messages, list) else []
        if not segments:
            return data

        started = time.time()
        counts = {}
        try:
            async with httpx.AsyncClient(timeout=self.http_timeout) as client:
                detections = await _gather_all(*(self._analyze(client, seg[2]) for seg in segments))
                vault, counts, plans = self._plan_masking(segments, detections)

                blocked = sorted(e for e in counts if self.entity_actions.get(e) == "BLOCK")
                if blocked:
                    self._record(data, "guardrail_intervened", started, counts)
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error": "Blocked by PII policy: request contains prohibited sensitive data",
                            "guardrail": self.guardrail_name,
                            "entities": blocked,
                        },
                    )
                if not plans:
                    self._record(data, "success", started, counts)
                    return data

                masked_texts = await _gather_all(
                    *(self._anonymize(client, seg[2], results, ops) for seg, results, ops in plans)
                )
            vault_id = secrets.token_hex(16)
            await self._vault_store(vault_id, vault)
        except HTTPException:
            raise
        except Exception as exc:
            verbose_proxy_logger.error("PII vault guardrail failed (%s): %s", type(exc).__name__, exc)
            self._record(data, "guardrail_failed_to_respond", started, counts, response={"error": type(exc).__name__})
            raise HTTPException(
                status_code=503,
                detail={"error": "PII guardrail unavailable", "guardrail": self.guardrail_name},
            )

        # The vault is persisted before the request is rewritten, so a masked prompt is always restorable.
        for (m_idx, b_idx, _), masked in zip((plan[0] for plan in plans), masked_texts):
            if b_idx is None:
                messages[m_idx]["content"] = masked
            else:
                messages[m_idx]["content"][b_idx]["text"] = masked
        metadata[VAULT_ID_FIELD] = vault_id

        self._record(data, "success", started, counts)
        verbose_proxy_logger.info(
            "PII vault: masked %d value(s) %s -> redis vault %s… (ttl=%ss)",
            sum(counts.values()), counts, vault_id[:8], self.vault_ttl_seconds,
        )
        return data

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        if self.should_run_guardrail(data=data, event_type=GuardrailEventHooks.post_call) is not True:
            return response
        vault_id = self._pop_vault_id(data)
        if not vault_id:
            return response

        try:
            vault = await self._vault_take(vault_id)
        except Exception as exc:
            # Fail safe: the response only holds placeholders, so returning it leaks nothing.
            verbose_proxy_logger.error("PII vault read failed; returning masked response (%s): %s", type(exc).__name__, exc)
            return response
        if not vault:
            verbose_proxy_logger.warning("PII vault %s… expired or missing; returning masked response", vault_id[:8])
            return response

        restored = self._rehydrate_response(response, vault)
        verbose_proxy_logger.info(
            "PII vault: rehydrated %d placeholder(s) from redis vault %s… (deleted)", restored, vault_id[:8]
        )
        return response

    async def async_post_call_failure_hook(
        self, request_data, original_exception, user_api_key_dict, traceback_str=None
    ):
        vault_id = self._pop_vault_id(request_data)
        if vault_id:
            try:
                await self._redis_client().delete(VAULT_KEY_PREFIX + vault_id)
            except Exception as exc:
                verbose_proxy_logger.warning("PII vault purge failed; TTL will expire it (%s): %s", type(exc).__name__, exc)
        return None

    # ── Rehydration ──────────────────────────────────────────────────────────
    @staticmethod
    def _token_pattern(vault):
        names = "|".join(re.escape(token[1:-1]) for token in sorted(vault, key=len, reverse=True))
        # Exact token, a Markdown-escaped one (\[PERSON_1\]), or a bare PERSON_1 if the model dropped the brackets.
        return re.compile(rf"\\?\[({names})\\?\]|\b({names})\b")

    @staticmethod
    def _restore(text, vault, pattern, json_escape=False):
        def swap(match):
            value = vault[f"[{match.group(1) or match.group(2)}]"]
            return json.dumps(value)[1:-1] if json_escape else value

        return pattern.subn(swap, text)

    def _rehydrate_response(self, response, vault):
        pattern = self._token_pattern(vault)
        restored = 0
        for choice in getattr(response, "choices", None) or []:
            message = getattr(choice, "message", None)
            if message is None:
                continue
            content = getattr(message, "content", None)
            if isinstance(content, str):
                message.content, n = self._restore(content, vault, pattern)
                restored += n
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        block["text"], n = self._restore(block["text"], vault, pattern)
                        restored += n
            for tool_call in getattr(message, "tool_calls", None) or []:
                function = getattr(tool_call, "function", None)
                if function is not None and isinstance(getattr(function, "arguments", None), str):
                    # Tool arguments are JSON strings, so restored values must stay JSON-escaped.
                    function.arguments, n = self._restore(function.arguments, vault, pattern, json_escape=True)
                    restored += n
        return restored
