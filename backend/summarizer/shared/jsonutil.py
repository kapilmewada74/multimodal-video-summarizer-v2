import json
import logging
import re
from typing import Any, Dict

logger = logging.getLogger("summarizer.json")


def clean_json_text(text: str) -> str:
    """Strip markdown code fences from an AI reply."""
    text = text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    return match.group(1).strip() if match else text


def parse_json_safely(raw_text: str, fallback_type: str = "flashcards") -> Dict[str, Any]:
    """Parse an AI reply as JSON. If it is unusable, return a small placeholder
    of the requested kind ("flashcards", "ppt" or "quiz") instead of failing."""
    cleaned = clean_json_text(raw_text)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except ValueError:
        logger.warning("AI reply was not valid JSON; trying to recover.")
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start != -1 and end != -1:
            try:
                parsed = json.loads(cleaned[start:end + 1])
                if isinstance(parsed, dict):
                    return parsed
            except ValueError:
                pass

    if fallback_type == "flashcards":
        return {"flashcards": [{"front": "Key Takeaway", "back": cleaned[:300], "tag": "Overview"}]}
    if fallback_type == "ppt":
        return {"title": "Video Presentation",
                "slides": [{"title": "Overview", "bullets": [cleaned[:200]], "notes": "Key points from video."}]}
    return {"quiz": [{
        "question": "What is the primary topic discussed in the video?",
        "options": ["Key Subject", "Alternative Topic A", "Alternative Topic B", "Alternative Topic C"],
        "answerIndex": 0,
        "explanation": "Derived from the summary and transcript.",
    }]}
