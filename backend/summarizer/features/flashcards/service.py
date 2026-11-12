"""Flashcards generated from a video summary."""
import logging
from typing import Any, Dict

from ...shared.cache import BoundedCache, make_cache_key
from ...shared.jsonutil import parse_json_safely
from ...shared.llm import FallbackChain, LLMUnavailable, json_chain

logger = logging.getLogger("summarizer.flashcards")
_cache = BoundedCache()

FLASHCARD_SYSTEM_PROMPT = """You are an expert educational specialist designing high-retention study flashcards.
Based strictly on the provided video summary and transcript, generate 6 to 10 comprehensive, active-recall study flashcards.
Requirements:
1. Front: Formulate as an engaging, direct question or targeted concept name (e.g. "What is the primary purpose of ...?", "How does ... solve the problem of ...?", "What are the 3 key pillars of ...?").
2. Back: Provide an accurate, comprehensive, easy-to-read explanation (2-3 sentences or clean bullet points).
3. Tag: Relevant topic category (e.g. "Definition", "Architecture", "Key Concept", "Framework", "Practical Application").
4. Mathematical Formulas: If the topic involves mathematical equations, statistical formulas, or quantitative metrics (e.g. Min-Max Scaling, Normalization, Standard Deviation, loss functions, algorithms), ALWAYS format them in standard LaTeX notation ($...$ inline or $$...$$ display) so they render as proper mathematical formulas.

Return ONLY a valid JSON object matching this schema:
{
  "flashcards": [
    {
      "front": "Clear question or targeted concept",
      "back": "Accurate, structured explanation with key details",
      "tag": "Category"
    }
  ]
}
"""


def generate_flashcards(title: str, summary: str, transcript: str = "",
                        force_refresh: bool = False, chain: FallbackChain | None = None) -> Dict[str, Any]:
    key = make_cache_key("flashcards", title, summary)
    if force_refresh:
        _cache.pop(key)
    elif (cached := _cache.get(key)) is not None:
        return cached

    prompt = f"TITLE: {title}\n\nSUMMARY:\n{summary}\n\nTRANSCRIPT EXCERPT:\n{transcript[:8000]}"
    try:
        result = (chain or json_chain()).complete(prompt, system=FLASHCARD_SYSTEM_PROMPT, json_mode=True)
    except LLMUnavailable as exc:
        # The fallback is deliberately not cached, so the next request can
        # try the AI providers again.
        logger.warning("%s; using the rule-based fallback.", exc)
        return rule_based_flashcards(title, summary)

    data = parse_json_safely(result.text, "flashcards")
    data["provider"] = ""
    _cache.put(key, data)
    return data


def rule_based_flashcards(title: str, summary: str) -> Dict[str, Any]:
    """Simple flashcards built from the bullet points of the summary."""
    lines = [l.strip() for l in summary.split("\n") if l.strip().startswith(("- ", "* "))]
    cards = []
    for line in lines[:8]:
        clean = line.lstrip("-* ").strip()
        if ":" in clean:
            front, back = clean.split(":", 1)
            cards.append({"front": front.strip(), "back": back.strip(), "tag": "Key Point"})
        else:
            cards.append({"front": "Concept", "back": clean, "tag": "Note"})
    if not cards:
        cards = [{"front": "Main Subject", "back": title, "tag": "Overview"}]
    return {"flashcards": cards, "provider": "Rule-based fallback"}


def clear_cache() -> None:
    _cache.clear()
