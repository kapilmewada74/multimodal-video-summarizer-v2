"""Opens a video's flashcards, quiz, mind map or slides, generating them the
first time they are needed.

An output is generated once per video (and variant) and then shared by
everyone who has the video, so a popular video costs AI money only once.
"""
import logging
import threading
from contextlib import contextmanager
from typing import Any, Dict

from ...core.config import get_settings
from ...core.db import connection
from ...core.errors import AppError
from ..flashcards import service as flashcards
from ..jobs import repository as jobs_repo
from ..mindmaps import service as mindmaps
from ..quizzes import service as quizzes
from ..slides import service as slides
from . import repository as repo

logger = logging.getLogger("summarizer.outputs")

FALLBACK_LABEL = "Rule-based fallback"

_locks: Dict[str, list] = {}
_locks_guard = threading.Lock()


@contextmanager
def _one_at_a_time(key: str):
    """Within one process, only one request generates a given output at a time;
    others wait and then find the stored result."""
    with _locks_guard:
        entry = _locks.setdefault(key, [threading.Lock(), 0])
        entry[1] += 1
    try:
        with entry[0]:
            yield
    finally:
        with _locks_guard:
            entry[1] -= 1
            if entry[1] == 0:
                _locks.pop(key, None)


def quiz_variant(difficulty: str, num_questions: int) -> str:
    return f"{difficulty}:{num_questions}"


def _generate(kind: str, title: str, summary: str, transcript: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if kind == "flashcards":
        return flashcards.generate_flashcards(title, summary, transcript, force_refresh=True)
    if kind == "slides":
        return slides.generate_presentation(title, summary, transcript, force_refresh=True)
    if kind == "mindmap":
        return mindmaps.generate_mindmap(title, summary)
    if kind == "quiz":
        return quizzes.generate_quiz(title, summary, transcript, difficulty=params["difficulty"],
                                     num_questions=params["num_questions"], force_refresh=True)
    raise ValueError(f"Unknown output kind: {kind}")


MAX_CONTEXT_CHARS = 12_000   # of the user's own material added to the prompt
MAX_PER_DOCUMENT_CHARS = 6_000


def build_context(documents) -> tuple[str, list[str]]:
    """The user's document text, trimmed so one big file cannot crowd out the rest.
    Returns (text for the prompt, filenames that were used)."""
    parts: list[str] = []
    used: list[str] = []
    budget = MAX_CONTEXT_CHARS
    for doc in documents:
        if budget <= 0:
            break
        text = " ".join((doc["extracted_text"] or "").split())[: min(MAX_PER_DOCUMENT_CHARS, budget)]
        if not text:
            continue
        parts.append(f"[{doc['filename']}]\n{text}")
        used.append(doc["filename"])
        budget -= len(text)
    return "\n\n".join(parts), used


def _get_or_generate_with_documents(user_id: str, video_id: str, kind: str, variant: str, force: bool,
                                    params: Dict[str, Any]) -> Dict[str, Any]:
    """Like get_or_generate, but the AI also sees the user's own documents for this video.
    The result is private to the user (it contains text from their files)."""
    if not force:
        with connection() as conn:
            stored = repo.get_user_output(conn, user_id, video_id, kind, variant)
        if stored is not None:
            return stored

    with connection() as conn:
        result = jobs_repo.get_result(conn, video_id)
        documents = repo.document_texts(conn, user_id, video_id)
    if not result:
        raise AppError(409, "video_not_ready", "This video is still being processed.")
    context, used = build_context(documents)
    if not context:
        raise AppError(409, "no_documents", "Attach a document with readable text to this video first.")

    with _one_at_a_time(f"{user_id}:{video_id}:{kind}:{variant}:docs"):
        if not force:
            with connection() as conn:
                stored = repo.get_user_output(conn, user_id, video_id, kind, variant)
            if stored is not None:
                return stored
        limit = get_settings().generation_daily_limit
        with connection() as conn:
            used_today = repo.bump_generation_usage(conn, user_id, limit)
        if used_today < 0:
            raise AppError(429, "generation_limit_reached", f"You reached today's limit of {limit} generations.")
        summary = f"{result['summary']}\n\nADDITIONAL STUDY MATERIAL FROM THE STUDENT'S OWN DOCUMENTS " \
                  f"(use it together with the summary):\n{context}"
        content = _generate(kind, result["title"] or "Video", summary, result["transcript"], params)
        content = {**content, "used_documents": used}
        if content.get("provider") == FALLBACK_LABEL:
            return content
        with connection() as conn:
            return repo.put_user_output(conn, user_id, video_id, kind, variant, content)


def _generation_limit(is_guest: bool) -> int:
    settings = get_settings()
    return settings.guest_generation_limit if is_guest else settings.generation_daily_limit


def get_or_generate(user_id: str, video_id: str, kind: str, *, force: bool = False,
                    difficulty: str = "medium", num_questions: int = 5, use_documents: bool = False,
                    is_guest: bool = False) -> Dict[str, Any]:
    """Return the stored output, or generate (and store) it.

    Opening an existing output is free. Generating counts against the user's
    daily generation limit. If no AI provider is available a simple fallback
    is returned but not stored, so the next request can try again.

    Database connections are borrowed only for the short queries. None is held
    while waiting for the AI (which can take a minute), so a few slow
    generations can never use up the connection pool.
    """
    if kind not in repo.KINDS:
        raise AppError(404, "unknown_output", "Unknown output type.")
    variant = quiz_variant(difficulty, num_questions) if kind == "quiz" else ""
    if use_documents:
        if is_guest:
            raise AppError(403, "account_required", "Sign in to use your own documents with a video.")
        return _get_or_generate_with_documents(user_id, video_id, kind, variant, force,
                                               {"difficulty": difficulty, "num_questions": num_questions})

    if not force:
        with connection() as conn:
            stored = repo.get_output(conn, video_id, kind, variant)
        if stored is not None:
            return stored

    with connection() as conn:
        result = jobs_repo.get_result(conn, video_id)
    if not result:
        raise AppError(409, "video_not_ready", "This video is still being processed.")

    with _one_at_a_time(f"{video_id}:{kind}:{variant}"):
        if not force:  # another request may have finished while we waited
            with connection() as conn:
                stored = repo.get_output(conn, video_id, kind, variant)
            if stored is not None:
                return stored

        limit = _generation_limit(is_guest)
        with connection() as conn:
            used = repo.bump_generation_usage(conn, user_id, limit)
        if used < 0:
            raise AppError(429, "generation_limit_reached",
                           f"You reached today's limit of {limit} generations. Opening existing "
                           "flashcards, quizzes, mind maps and slides still works.")

        # No database connection is held during this slow call.
        content = _generate(kind, result["title"] or "Video", result["summary"], result["transcript"],
                            {"difficulty": difficulty, "num_questions": num_questions})
        if content.get("provider") == FALLBACK_LABEL:
            return content  # shown, but not stored
        with connection() as conn:
            return repo.put_output(conn, video_id, kind, variant, content, replace=force)
