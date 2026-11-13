"""The browser is never told which vendors or models are behind the service."""
import json

import pytest

from apiutil import ready_video
from summarizer.shared.public import public_engine, public_message


@pytest.mark.parametrize("label,expected", [
    ("Groq AI (llama-3.3-70b)", "AI"), ("Gemini AI", "AI"), ("Fake (test-model)", "AI"), ("xAI Grok", "AI"),
    ("Rule-based fallback", "Rule-based fallback"), (None, None), ("", ""),
])
def test_engine_labels_are_generic(label, expected):
    assert public_engine(label) == expected


def test_the_job_message_does_not_name_the_engine():
    assert public_message("Video successfully summarized with Groq AI (llama)!") == "Video successfully summarized!"
    assert public_message("Waiting for a free worker...") == "Waiting for a free worker..."
    assert public_message(None) == ""


def test_api_answers_do_not_name_vendors_or_models(api, tmp_path):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    from apiutil import make_deps
    from summarizer.features.jobs import worker
    worker.run_once(make_deps(tmp_path), "w")
    job = api.client.get(f"/api/job/{job_id}", headers=user.headers).json()
    video_id = job["video_id"]
    detail = api.client.get(f"/api/videos/{video_id}", headers=user.headers).json()
    history = api.client.get("/api/history", headers=user.headers).json()
    text = json.dumps([job, detail, history]).lower()
    for name in ("groq", "gemini", "whisper", "grok", "xai", "fake", "llama", "openai", "supabase"):
        assert name not in text, name
    assert job["result"]["engine"] == "AI" and detail["engine"] == "AI"
    assert job["message"] == "Video successfully summarized!"


def test_a_ready_video_helper_still_works(api, tmp_path):
    assert ready_video(api, api.user(), tmp_path)
