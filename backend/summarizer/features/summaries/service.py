"""Turns a transcript into a clean markdown study summary."""
import logging
import os
from typing import List, Optional, Tuple

from ...shared.llm import FallbackChain, summary_chain
from ...shared.textutils import split_text
from .cleanup import clean_and_deduplicate_summary
from .prompts import CHUNK_PROMPT, MERGE_PROMPT, SUMMARY_PROMPT

logger = logging.getLogger("summarizer.summary")


def _limits() -> Tuple[int, int]:
    single = int(os.getenv("SUMMARY_SINGLE_PASS_CHARS", "30000"))
    chunk = int(os.getenv("SUMMARY_CHUNK_CHARS", "20000"))
    return single, chunk


def _fill(template: str, **values: str) -> str:
    # str.replace instead of str.format: transcripts and notes contain braces
    # (code, LaTeX) that format() would try to interpret.
    for name, value in values.items():
        template = template.replace("{" + name + "}", value)
    return template


def summarize_transcript(transcript: str, chain: Optional[FallbackChain] = None) -> Tuple[str, str]:
    """Return (clean markdown summary, engine label).

    Short transcripts take one request. Long ones are summarized in parts and
    the parts are merged, so a long lecture never exceeds the model's limits.
    """
    chain = chain or summary_chain()
    single_limit, chunk_size = _limits()
    transcript = transcript.strip()

    if len(transcript) <= single_limit:
        result = chain.complete(_fill(SUMMARY_PROMPT, transcript=transcript))
        return clean_and_deduplicate_summary(result.text), result.label

    parts = split_text(transcript, chunk_size)
    logger.info("Long transcript (%d characters): summarizing in %d parts.", len(transcript), len(parts))
    notes: List[str] = []
    last = None
    for index, part in enumerate(parts, start=1):
        last = chain.complete(_fill(CHUNK_PROMPT, part=str(index), total=str(len(parts)), transcript=part))
        notes.append(last.text)

    # Merge. If the combined notes are still too long, merge in groups first.
    while True:
        joined = "\n\n".join(f"--- Part {i} ---\n{n}" for i, n in enumerate(notes, start=1))
        if len(joined) <= single_limit or len(notes) <= 2:
            break
        group_size = max(2, len(notes) // 2)
        grouped = []
        for start in range(0, len(notes), group_size):
            block = "\n\n".join(notes[start:start + group_size])
            last = chain.complete(_fill(MERGE_PROMPT, summaries=block))
            grouped.append(last.text)
        notes = grouped

    final = chain.complete(_fill(MERGE_PROMPT, summaries=joined))
    return clean_and_deduplicate_summary(final.text), final.label
