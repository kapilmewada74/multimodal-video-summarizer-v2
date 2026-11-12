"""Multiple-choice quiz generated from a video summary."""
import logging
from typing import Any, Dict

from ...shared.cache import BoundedCache, make_cache_key
from ...shared.jsonutil import parse_json_safely
from ...shared.llm import FallbackChain, LLMUnavailable, quiz_chain

logger = logging.getLogger("summarizer.quiz")
_cache = BoundedCache()

DIFFICULTY_TEXT = {
    "easy": "EASY (fundamental definitions, direct facts, basic recall)",
    "medium": "MEDIUM (conceptual understanding, logical deduction, practical context)",
    "hard": "HARD (subtle edge cases, deep analysis, tricky plausible distractors)",
}


def build_quiz_prompt(num_questions: int, difficulty: str) -> str:
    diff_text = DIFFICULTY_TEXT.get(difficulty.lower(), DIFFICULTY_TEXT["medium"])
    return f"""You are an expert exam educator creating interactive test quizzes.
Based strictly on the provided summary and transcript, generate {num_questions} multiple choice questions.
TARGET DIFFICULTY: {diff_text}
Each question must test understanding at this difficulty level, have 4 distinct plausible options, indicate the correct option index (0 to 3), and provide a concise, high-value explanation.
If questions, options, or explanations involve mathematical equations or formulas, format them in standard LaTeX notation ($...$).

Return ONLY a valid JSON object matching this schema:
{{
  "quiz": [
    {{
      "question": "Clear question text?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0,
      "explanation": "Concise explanation why the correct option is right."
    }}
  ]
}}
"""


def generate_quiz(title: str, summary: str, transcript: str = "", difficulty: str = "medium",
                  num_questions: int = 5, force_refresh: bool = False,
                  chain: FallbackChain | None = None) -> Dict[str, Any]:
    key = make_cache_key("quiz", title, difficulty, str(num_questions), summary)
    if force_refresh:
        _cache.pop(key)
    elif (cached := _cache.get(key)) is not None:
        return cached

    prompt = f"TITLE: {title}\nDIFFICULTY: {difficulty}\n\nSUMMARY:\n{summary}\n\nTRANSCRIPT EXCERPT:\n{transcript[:4000]}"
    try:
        result = (chain or quiz_chain()).complete(prompt, system=build_quiz_prompt(num_questions, difficulty),
                                                  json_mode=True, timeout=45.0)
    except LLMUnavailable as exc:
        logger.warning("%s; returning the minimal quiz.", exc)
        return minimal_quiz(title, difficulty)

    data = parse_json_safely(result.text, "quiz")
    data["provider"] = ""
    data["difficulty"] = difficulty
    _cache.put(key, data)
    return data


def minimal_quiz(title: str, difficulty: str) -> Dict[str, Any]:
    """A single placeholder question, used only when no AI provider answers."""
    return {
        "quiz": [{
            "question": f"What was the primary focus of '{title}'?",
            "options": [title, "Unrelated General Discussion", "Historical Chronology Only", "Future Speculation"],
            "answerIndex": 0,
            "explanation": f"The primary subject of this video is {title}.",
        }],
        "provider": "Rule-based fallback",
        "difficulty": difficulty,
    }


def clear_cache() -> None:
    _cache.clear()
