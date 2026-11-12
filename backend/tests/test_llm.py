import httpx
import pytest

from summarizer.shared import llm
from summarizer.shared.llm import (FallbackChain, GeminiProvider, GrokProvider, GroqProvider, LLMResult,
                                   LLMUnavailable, Provider)


class Fake(Provider):
    def __init__(self, name, ok=True, available=True):
        self.name, self.ok, self._available, self.calls = name, ok, available, 0

    def available(self):
        return self._available

    def complete(self, prompt, **kwargs):
        self.calls += 1
        if not self.ok:
            raise RuntimeError("boom")
        return LLMResult(f"from {self.name}", self.name, "m")


def test_first_working_provider_answers():
    a, b = Fake("a"), Fake("b")
    assert FallbackChain([a, b]).complete("p").text == "from a"
    assert b.calls == 0


def test_failing_provider_falls_through_to_the_next():
    a, b = Fake("a", ok=False), Fake("b")
    assert FallbackChain([a, b]).complete("p").text == "from b"


def test_providers_without_keys_are_skipped():
    a, b = Fake("a", available=False), Fake("b")
    assert FallbackChain([a, b]).complete("p").text == "from b" and a.calls == 0


def test_error_when_nothing_works_lists_each_problem():
    chain = FallbackChain([Fake("a", available=False), Fake("b", ok=False)])
    with pytest.raises(LLMUnavailable) as err:
        chain.complete("p")
    assert "a: no API key" in str(err.value) and "b: RuntimeError" in str(err.value)


def test_availability(monkeypatch):
    assert not GroqProvider().available() and not GeminiProvider().available() and not GrokProvider().available()
    monkeypatch.setenv("GROQ_API_KEY", "k")
    monkeypatch.setenv("XAI_API_KEY", " 'noise' xai-abc123 ")
    assert GroqProvider().available() and GrokProvider().available()
    assert GrokProvider._key() == "xai-abc123"


def test_chains_are_ordered_for_each_use():
    assert [p.name for p in llm.summary_chain().providers] == ["Groq", "Gemini"]
    assert [p.name for p in llm.json_chain().providers][0] == "Gemini"
    assert [p.name for p in llm.quiz_chain().providers][0] == "Grok"


class FakeHttp:
    """Replaces httpx.post for provider tests."""
    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    def __call__(self, url, **kwargs):
        self.requests.append((url, kwargs))
        status, body = self.responses.pop(0)
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))


def gemini_body(text):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def test_gemini_sends_key_in_header_not_url_and_respects_json_mode(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "secret-key")
    http = FakeHttp([(200, gemini_body("hello"))])
    monkeypatch.setattr(llm.httpx, "post", http)
    result = GeminiProvider().complete("prompt", system="sys", json_mode=False, timeout=42)
    url, kwargs = http.requests[0]
    assert result.text == "hello" and result.provider == "Gemini"
    assert "secret-key" not in url and kwargs["headers"]["x-goog-api-key"] == "secret-key"
    assert "responseMimeType" not in kwargs["json"]["generationConfig"] and kwargs["timeout"] == 42
    assert kwargs["json"]["contents"][0]["parts"][0]["text"].startswith("sys")

    http = FakeHttp([(200, gemini_body("{}"))])
    monkeypatch.setattr(llm.httpx, "post", http)
    GeminiProvider().complete("p", json_mode=True)
    assert http.requests[0][1]["json"]["generationConfig"]["responseMimeType"] == "application/json"


def test_gemini_tries_the_next_model_when_one_fails(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    http = FakeHttp([(500, {}), (200, gemini_body("ok"))])
    monkeypatch.setattr(llm.httpx, "post", http)
    result = GeminiProvider().complete("p")
    assert result.text == "ok" and len(http.requests) == 2
    assert http.requests[0][0] != http.requests[1][0]


def test_gemini_reports_failure_when_every_model_fails(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(llm.httpx, "post", FakeHttp([(500, {})] * 5))
    with pytest.raises(RuntimeError, match="Gemini failed"):
        GeminiProvider().complete("p")


def test_configured_gemini_model_is_tried_first(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "my-model")
    assert GeminiProvider.models()[0] == "my-model"


def test_grok_request_shape(monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "xai-key")
    http = FakeHttp([(200, {"choices": [{"message": {"content": "answer"}}]})])
    monkeypatch.setattr(llm.httpx, "post", http)
    result = GrokProvider().complete("p", system="s")
    url, kwargs = http.requests[0]
    assert result.text == "answer" and url == "https://api.x.ai/v1/chat/completions"
    assert kwargs["headers"]["Authorization"] == "Bearer xai-key"
    assert [m["role"] for m in kwargs["json"]["messages"]] == ["system", "user"]


def test_grok_http_error_is_raised(monkeypatch):
    monkeypatch.setenv("XAI_API_KEY", "xai-key")
    monkeypatch.setattr(llm.httpx, "post", FakeHttp([(401, {})]))
    with pytest.raises(httpx.HTTPStatusError):
        GrokProvider().complete("p")
