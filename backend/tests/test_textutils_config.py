import pytest

from conftest import set_env
from summarizer.core.config import get_settings
from summarizer.shared.net import hash_ip
from summarizer.shared.textutils import split_text


def test_short_text_is_one_chunk_and_empty_is_none():
    assert split_text("hello", 100) == ["hello"]
    assert split_text("   ", 100) == []


def test_chunks_respect_size_and_cover_everything():
    words = [f"word{i:03d}" for i in range(500)]
    text = " ".join(words)
    chunks = split_text(text, 400, overlap=50)
    assert len(chunks) > 5 and all(len(c) <= 400 for c in chunks)
    joined = " ".join(chunks)
    assert all(w in joined for w in words)


def test_chunks_prefer_sentence_boundaries():
    text = ("This is a sentence. " * 30).strip()
    chunks = split_text(text, 200, overlap=0)
    assert all(c.endswith(".") for c in chunks[:-1])


def test_invalid_chunk_size_is_rejected():
    with pytest.raises(ValueError):
        split_text("abc", 0)


def test_settings_defaults_and_overrides(monkeypatch):
    s = get_settings()
    assert s.environment == "development" and s.run_embedded_worker is True
    assert s.cors_origins == ["http://localhost:3000", "http://127.0.0.1:3000"]
    assert s.ip_daily_limit == 30 and s.max_upload_bytes == 500 * 1024 * 1024
    set_env(monkeypatch, ENVIRONMENT="production", CORS_ORIGINS="https://a.com, https://b.com",
            SUPABASE_URL="https://x.supabase.co/", MAX_UPLOAD_MB="5", IP_DAILY_LIMIT="oops")
    s = get_settings()
    assert s.is_production and s.run_embedded_worker is False  # production: worker runs separately
    assert s.cors_origins == ["https://a.com", "https://b.com"]
    assert s.supabase_url == "https://x.supabase.co" and s.max_upload_bytes == 5 * 1024 * 1024
    assert s.ip_daily_limit == 30  # unparsable value falls back to the default


def test_ip_hash_is_stable_salted_and_not_reversible_looking(monkeypatch):
    assert hash_ip("1.2.3.4") == hash_ip("1.2.3.4") != hash_ip("1.2.3.5")
    before = hash_ip("1.2.3.4")
    monkeypatch.setenv("IP_HASH_SALT", "other")
    assert hash_ip("1.2.3.4") != before and "1.2.3.4" not in before
