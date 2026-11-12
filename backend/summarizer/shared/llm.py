"""AI providers behind one interface, with automatic fallback.

Every provider has `complete(prompt, ...)`. A `FallbackChain` tries its
providers in order and moves on when one is missing a key or fails, so the
rest of the code never needs to know which vendor answered.
"""
import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional

import httpx

logger = logging.getLogger("summarizer.llm")


@dataclass(frozen=True)
class LLMResult:
    text: str
    provider: str
    model: str

    @property
    def label(self) -> str:
        return f"{self.provider} ({self.model})"


class LLMUnavailable(Exception):
    """No configured provider produced an answer."""


class Provider(ABC):
    name = "provider"

    @abstractmethod
    def available(self) -> bool:
        """True when the provider has the credentials it needs."""

    @abstractmethod
    def complete(self, prompt: str, *, system: Optional[str] = None,
                 json_mode: bool = False, timeout: float = 60.0) -> LLMResult:
        """Return the model's answer or raise an exception."""


class GroqProvider(Provider):
    name = "Groq"

    def __init__(self, model: Optional[str] = None):
        self.model = model or os.getenv("MODEL_NAME", "openai/gpt-oss-20b").strip().strip('"')

    def available(self) -> bool:
        return bool(os.getenv("GROQ_API_KEY"))

    def complete(self, prompt, *, system=None, json_mode=False, timeout=60.0) -> LLMResult:
        from groq import Groq

        client = Groq(api_key=os.environ["GROQ_API_KEY"].strip().strip('"'),
                      timeout=max(timeout, 120.0), max_retries=2)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        params = dict(model=self.model, messages=messages, temperature=0.2,
                      max_completion_tokens=4000, stream=False)
        if "gpt-oss" in self.model:
            params.update(reasoning_effort="medium", reasoning_format="hidden")
        if json_mode:
            params["response_format"] = {"type": "json_object"}
        response = client.chat.completions.create(**params)
        if not response.choices:
            raise ValueError("Groq returned no choices.")
        choice = response.choices[0]
        text = (choice.message.content or "").strip()
        if not text:
            raise ValueError(f"Groq returned an empty answer (finish reason: {choice.finish_reason}).")
        if choice.finish_reason == "length":
            logger.warning("Groq reached the output token limit; the answer may be cut off.")
        return LLMResult(text, self.name, self.model)


class GeminiProvider(Provider):
    name = "Gemini"
    BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def available(self) -> bool:
        return bool(os.getenv("GEMINI_API_KEY"))

    @staticmethod
    def models() -> List[str]:
        configured = os.getenv("GEMINI_MODEL", "").strip()
        models = ["gemini-2.5-flash-lite", "gemini-flash-latest"]
        if configured and configured not in models:
            models.insert(0, configured)
        return models

    def complete(self, prompt, *, system=None, json_mode=False, timeout=60.0) -> LLMResult:
        key = os.environ["GEMINI_API_KEY"].strip()
        text_in = f"{system}\n\n{prompt}" if system else prompt
        config = {"temperature": 0.2}
        if json_mode:
            config["responseMimeType"] = "application/json"
        payload = {"contents": [{"parts": [{"text": text_in}]}], "generationConfig": config}
        errors = []
        for model in self.models():
            try:
                # The key travels in a header, never in the URL, so it cannot
                # end up in request logs.
                response = httpx.post(f"{self.BASE}/{model}:generateContent", json=payload,
                                      headers={"x-goog-api-key": key}, timeout=timeout)
                if response.status_code != 200:
                    errors.append(f"{model}: HTTP {response.status_code}")
                    continue
                text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
                if text and text.strip():
                    return LLMResult(text.strip(), self.name, model)
                errors.append(f"{model}: empty answer")
            except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
                errors.append(f"{model}: {type(exc).__name__}")
        raise RuntimeError("Gemini failed (" + "; ".join(errors) + ")")


class GrokProvider(Provider):
    name = "Grok"
    URL = "https://api.x.ai/v1/chat/completions"

    @staticmethod
    def _key() -> Optional[str]:
        raw = os.getenv("XAI_API_KEY") or os.getenv("GROK_API_KEY")
        if not raw:
            return None
        raw = raw.strip().strip('"')
        return "xai-" + raw.split("xai-", 1)[1].strip() if "xai-" in raw else raw

    def available(self) -> bool:
        return bool(self._key())

    def complete(self, prompt, *, system=None, json_mode=False, timeout=60.0) -> LLMResult:
        model = os.getenv("XAI_MODEL", "grok-2-mini")
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = httpx.post(
            self.URL,
            headers={"Authorization": f"Bearer {self._key()}"},
            json={"model": model, "messages": messages, "temperature": 0.2},
            timeout=timeout,
        )
        response.raise_for_status()
        text = response.json()["choices"][0]["message"]["content"]
        if not text or not text.strip():
            raise ValueError("Grok returned an empty answer.")
        return LLMResult(text.strip(), self.name, model)


class FallbackChain:
    def __init__(self, providers: List[Provider]):
        self.providers = providers

    def available(self) -> bool:
        return any(p.available() for p in self.providers)

    def complete(self, prompt: str, *, system: Optional[str] = None,
                 json_mode: bool = False, timeout: float = 60.0) -> LLMResult:
        problems = []
        for provider in self.providers:
            if not provider.available():
                problems.append(f"{provider.name}: no API key")
                continue
            try:
                return provider.complete(prompt, system=system, json_mode=json_mode, timeout=timeout)
            except Exception as exc:  # any provider failure moves on to the next one
                logger.warning("%s failed: %s", provider.name, type(exc).__name__)
                problems.append(f"{provider.name}: {type(exc).__name__}")
        raise LLMUnavailable("No AI provider could answer (" + "; ".join(problems) + ")")


def summary_chain() -> FallbackChain:
    return FallbackChain([GroqProvider(), GeminiProvider()])


def json_chain() -> FallbackChain:
    """Flashcards and slides."""
    return FallbackChain([GeminiProvider(), GroqProvider()])


def quiz_chain() -> FallbackChain:
    return FallbackChain([GrokProvider(), GeminiProvider(), GroqProvider()])
