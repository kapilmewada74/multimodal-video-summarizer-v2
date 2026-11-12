"""A study pack as one Markdown file: summary, mind map, flashcards, quiz, transcript."""
from typing import Any, Dict, List, Optional


def _outline(node: Dict[str, Any], depth: int = 0) -> List[str]:
    lines = [f"{'  ' * depth}- {node.get('title', '')}"]
    for child in node.get("children") or []:
        lines.extend(_outline(child, depth + 1))
    return lines


def mindmap_to_markdown(mindmap: Dict[str, Any]) -> str:
    return "\n".join(_outline(mindmap))


def build_markdown(video: Dict[str, Any], outputs: List[Dict[str, Any]], include_transcript: bool = True) -> str:
    """Only outputs that already exist are included; exporting never calls the AI."""
    parts = [f"# {video.get('title') or 'Video'}"]
    minutes = (video.get("duration") or 0) // 60
    if minutes:
        parts.append(f"*Length: {minutes} min*")
    parts.append(video.get("summary", "").strip())

    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for item in outputs:
        by_kind.setdefault(item["kind"], []).append(item)

    for item in by_kind.get("mindmap", [])[:1]:
        parts.append("## Mind map\n\n" + mindmap_to_markdown(item["content"]))

    for item in by_kind.get("flashcards", [])[:1]:
        cards = item["content"].get("flashcards") or []
        if cards:
            rows = [f"{i}. **{c.get('front', '')}**\n   {c.get('back', '')}" for i, c in enumerate(cards, 1)]
            parts.append("## Flashcards\n\n" + "\n".join(rows))

    for item in by_kind.get("quiz", [])[:1]:
        questions = item["content"].get("quiz") or []
        blocks = []
        for i, q in enumerate(questions, 1):
            options = q.get("options") or []
            answer = q.get("answerIndex")
            lines = [f"{i}. {q.get('question', '')}"]
            for j, option in enumerate(options):
                mark = " ✓" if j == answer else ""
                lines.append(f"   - {chr(65 + j)}. {option}{mark}")
            if q.get("explanation"):
                lines.append(f"   *{q['explanation']}*")
            blocks.append("\n".join(lines))
        if blocks:
            parts.append("## Quiz\n\n" + "\n\n".join(blocks))

    transcript: Optional[str] = video.get("transcript")
    if include_transcript and transcript:
        parts.append("## Transcript\n\n" + transcript.strip())

    return "\n\n".join(p for p in parts if p).strip() + "\n"
