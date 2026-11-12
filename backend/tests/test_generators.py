import io
import zipfile

import pytest

from summarizer.features.flashcards import service as flashcards
from summarizer.features.quizzes import service as quizzes
from summarizer.features.slides import service as slides
from summarizer.features.slides.pptx import build_pptx_file
from summarizer.shared.cache import BoundedCache, make_cache_key
from summarizer.shared.jsonutil import parse_json_safely
from summarizer.shared.llm import LLMResult, LLMUnavailable


class FakeChain:
    def __init__(self, text=None, fail=False):
        self.text, self.fail, self.calls, self.last = text, fail, 0, None

    def complete(self, prompt, **kwargs):
        self.calls += 1
        self.last = (prompt, kwargs)
        if self.fail:
            raise LLMUnavailable("nothing available")
        return LLMResult(self.text, "Fake", "m")


# ---------- JSON parsing

def test_parse_plain_fenced_and_noisy_json():
    assert parse_json_safely('{"a": 1}') == {"a": 1}
    assert parse_json_safely('Here:\n```json\n{"flashcards": []}\n```') == {"flashcards": []}
    assert parse_json_safely('noise {"a": 2} more noise') == {"a": 2}


@pytest.mark.parametrize("kind,key", [("flashcards", "flashcards"), ("ppt", "slides"), ("quiz", "quiz")])
def test_garbage_gives_a_placeholder_of_the_right_kind(kind, key):
    assert parse_json_safely("not json at all", kind)[key]


def test_json_that_is_not_an_object_is_treated_as_garbage():
    assert "flashcards" in parse_json_safely("[1, 2, 3]", "flashcards")


# ---------- slide sanitising

def test_sanitize_enforces_budgets():
    data = {"title": "Deck", "slides": [{
        "title": "word " * 30, "bullets": [f"bullet {'w ' * 40}{i}" for i in range(10)],
        "summary": "s " * 100, "layout": "nonsense", "image_asset": "../../etc/passwd"}]}
    slide = slides.sanitize_presentation_data(data)["slides"][0]
    assert len(slide["title"].split()) <= 9 and len(slide["bullets"]) <= 4
    assert all(len(b.split()) <= 16 for b in slide["bullets"])
    assert slide["layout"] in {"split_left_image", "split_right_image", "cards_right"}
    assert slide["image_asset"].startswith("photo_")


def test_sanitize_handles_garbage_and_string_bullets():
    assert slides.sanitize_presentation_data("not a dict")["slides"]
    out = slides.sanitize_presentation_data({"slides": [{"title": "T", "bullets": "- one\n- two"}]})
    assert out["slides"][0]["bullets"] == ["one", "two"]


# ---------- generation, caching, fallbacks

def test_flashcards_use_the_ai_answer_and_cache_it():
    chain = FakeChain('{"flashcards": [{"front": "f", "back": "b", "tag": "t"}]}')
    first = flashcards.generate_flashcards("T", "S", "", chain=chain)
    second = flashcards.generate_flashcards("T", "S", "", chain=chain)
    assert first == second and chain.calls == 1 and chain.last[1]["json_mode"] is True
    flashcards.generate_flashcards("T", "S", "", force_refresh=True, chain=chain)
    assert chain.calls == 2


def test_different_summaries_do_not_share_a_cache_entry():
    chain = FakeChain('{"flashcards": []}')
    prefix = "x" * 400  # identical for far longer than the old 300-character key
    flashcards.generate_flashcards("T", prefix + "A", "", chain=chain)
    flashcards.generate_flashcards("T", prefix + "B", "", chain=chain)
    assert chain.calls == 2


def test_flashcards_fall_back_when_no_ai_and_are_not_cached():
    chain = FakeChain(fail=True)
    out = flashcards.generate_flashcards("T", "## Topic\n- Term: its meaning\n- Another point", "", chain=chain)
    assert out["provider"] == "Rule-based fallback"
    assert out["flashcards"][0] == {"front": "Term", "back": "its meaning", "tag": "Key Point"}
    flashcards.generate_flashcards("T", "## Topic\n- Term: its meaning\n- Another point", "", chain=chain)
    assert chain.calls == 2  # tried the AI again


def test_presentation_ai_and_fallback():
    ok = slides.generate_presentation("Deck", "S", "", chain=FakeChain('{"title": "X", "slides": [{"title": "One"}]}'))
    assert ok["slides"][0]["title"] == "One" and ok["provider"] == ""
    fallback = slides.generate_presentation("Deck", "## Intro\n- a\n- b\n## Next\n- c", "", chain=FakeChain(fail=True))
    assert fallback["provider"] == "Rule-based fallback" and len(fallback["slides"]) == 2


def test_quiz_prompt_reflects_difficulty_and_count():
    chain = FakeChain('{"quiz": []}')
    quizzes.generate_quiz("T", "S", "", difficulty="hard", num_questions=7, chain=chain)
    system = chain.last[1]["system"]
    assert "7 multiple choice" in system and "HARD" in system


def test_quiz_cache_distinguishes_difficulty_and_honours_refresh():
    chain = FakeChain('{"quiz": []}')
    quizzes.generate_quiz("T", "S", "", difficulty="easy", chain=chain)
    quizzes.generate_quiz("T", "S", "", difficulty="easy", chain=chain)
    quizzes.generate_quiz("T", "S", "", difficulty="hard", chain=chain)
    assert chain.calls == 2
    quizzes.generate_quiz("T", "S", "", difficulty="easy", force_refresh=True, chain=chain)
    assert chain.calls == 3


def test_quiz_minimal_fallback_is_marked():
    out = quizzes.generate_quiz("Title", "Summary", "", chain=FakeChain(fail=True))
    q = out["quiz"][0]
    assert out["provider"] == "Rule-based fallback" and len(q["options"]) == 4 and 0 <= q["answerIndex"] < 4


def test_cache_is_bounded_and_keys_use_full_content():
    cache = BoundedCache(3)
    for i in range(10):
        cache.put(f"k{i}", i)
    assert cache.keys() == ["k7", "k8", "k9"]
    assert make_cache_key("p", "a", "b") != make_cache_key("p", "ab", "")


# ---------- PPTX

@pytest.mark.parametrize("template", ["warm_hexagons", "modern_editorial", "unknown_template"])
def test_pptx_builds_for_every_template(template):
    data = {"title": "हिन्दी शीर्षक – Unicode", "template": template,
            "slides": [{"title": "One", "kicker": "K", "summary": "S", "bullets": ["a", "b"], "notes": "n"},
                       {"title": "Two", "bullets": ["c"]}]}
    blob = build_pptx_file(data)
    assert zipfile.is_zipfile(io.BytesIO(blob))
    assert any(n.startswith("ppt/slides/slide") for n in zipfile.ZipFile(io.BytesIO(blob)).namelist())
