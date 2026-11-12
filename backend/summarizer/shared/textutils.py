import re
from typing import List


def split_text(text: str, chunk_chars: int, overlap: int = 300) -> List[str]:
    """Split long text into pieces of about `chunk_chars`, preferring to cut at
    paragraph, line or sentence ends, with a small overlap between pieces."""
    text = text.strip()
    if chunk_chars <= 0:
        raise ValueError("chunk_chars must be positive")
    if len(text) <= chunk_chars:
        return [text] if text else []

    chunks: List[str] = []
    start = 0
    while start < len(text):
        end = min(start + chunk_chars, len(text))
        if end < len(text):
            window = text[start:end]
            cut = max(window.rfind("\n\n"), window.rfind("\n"), window.rfind(". "), window.rfind("? "),
                      window.rfind("! "), window.rfind(" "))
            if cut > chunk_chars * 0.5:
                end = start + cut + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text).strip()
