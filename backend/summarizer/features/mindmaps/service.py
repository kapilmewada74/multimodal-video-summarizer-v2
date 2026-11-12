"""Mind map (a tree of ideas) generated from a video summary."""
import logging
import re
from typing import Any, Dict, List

from ...shared.jsonutil import parse_json_safely
from ...shared.llm import FallbackChain, LLMUnavailable, json_chain

logger = logging.getLogger("summarizer.mindmap")

MAX_DEPTH = 4          # levels below the root
MAX_CHILDREN = 8       # per node
MAX_NODES = 60         # whole map
MAX_TITLE_CHARS = 90

MINDMAP_SYSTEM_PROMPT = """You are an expert at turning study material into clear mind maps.
Based strictly on the provided summary, create a hierarchical mind map of the video.

Rules:
1. The root is the main topic (2 to 6 words).
2. Use 3 to 6 main branches, each a key concept or section.
3. Each branch has 2 to 5 sub-points; go at most 3 levels deep below the root.
4. Every node title is short: a keyword or phrase of at most 8 words. No full sentences.
5. Use only information from the summary. Never invent facts.
6. If a formula matters, write it in LaTeX with $...$ inside the title.

Return ONLY a valid JSON object in this exact shape:
{
  "title": "Main Topic",
  "children": [
    {"title": "Branch", "children": [{"title": "Sub-point", "children": []}]}
  ]
}
"""


def _clean_title(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip().strip("-*•#: ")
    if len(text) > MAX_TITLE_CHARS:
        text = text[: MAX_TITLE_CHARS - 1].rstrip() + "…"
    return text


def sanitize_mindmap(data: Any, default_title: str = "Mind map") -> Dict[str, Any]:
    """Enforce the shape and size limits, whatever the AI returned."""
    budget = {"nodes": 0}

    def clean(node: Any, depth: int) -> Dict[str, Any] | None:
        if not isinstance(node, dict):
            return None
        title = _clean_title(node.get("title"))
        if not title or budget["nodes"] >= MAX_NODES:
            return None
        budget["nodes"] += 1
        children: List[Dict[str, Any]] = []
        raw_children = node.get("children")
        if depth < MAX_DEPTH and isinstance(raw_children, list):
            for child in raw_children[:MAX_CHILDREN]:
                cleaned = clean(child, depth + 1)
                if cleaned:
                    children.append(cleaned)
        return {"title": title, "children": children}

    root = clean(data, 0) if isinstance(data, dict) else None
    if not root:
        root = {"title": _clean_title(default_title) or "Mind map", "children": []}
    if not root["children"]:
        root["children"] = [{"title": "No details available", "children": []}]
    return root


def rule_based_mindmap(title: str, summary: str) -> Dict[str, Any]:
    """A simple map built from the `##` headings and bullet points of the summary."""
    branches: List[Dict[str, Any]] = []
    for block in re.split(r"(?m)^##\s+", summary)[1:]:
        lines = [l.strip() for l in block.split("\n") if l.strip()]
        if not lines:
            continue
        heading = re.sub(r"^\d+\.\s*", "", lines[0])
        bullets = [re.sub(r"^[-*]\s*", "", l) for l in lines[1:] if l.startswith(("-", "*"))]
        children = [{"title": b.split(":", 1)[0] if ":" in b and len(b.split(":", 1)[0]) < 60 else b, "children": []}
                    for b in bullets[:6]]
        branches.append({"title": heading, "children": children})
    return sanitize_mindmap({"title": title or "Mind map", "children": branches}, default_title=title)


def generate_mindmap(title: str, summary: str, chain: FallbackChain | None = None) -> Dict[str, Any]:
    prompt = f"TITLE: {title}\n\nSUMMARY:\n{summary}"
    try:
        result = (chain or json_chain()).complete(prompt, system=MINDMAP_SYSTEM_PROMPT, json_mode=True)
    except LLMUnavailable as exc:
        logger.warning("%s; using the rule-based mind map.", exc)
        data = rule_based_mindmap(title, summary)
        data["provider"] = "Rule-based fallback"
        return data

    parsed = parse_json_safely(result.text, "mindmap")
    data = sanitize_mindmap(parsed, default_title=title)
    data["provider"] = ""
    return data
