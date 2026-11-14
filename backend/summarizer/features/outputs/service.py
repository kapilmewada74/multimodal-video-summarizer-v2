"""Opens a video's flashcards, quiz, mind map or slides, generating them the
first time they are needed.

An output is generated once per video (and variant) and then shared by
everyone who has the video, so a popular video costs AI money only once.

Who may change what
-------------------
* The SHARED copy is written once, by whoever opens the output first. Nobody can overwrite it afterwards, so one
  person pressing "Regenerate" (or a script doing it) can never change what everyone else sees.
* "Regenerate" by a signed-in account makes that person's OWN copy. It is stored for them alone and is what they see
  from then on, until they switch back to the shared one. It costs a generation like any other, and is rate limited.
* A guest cannot regenerate (they have only the shared copy): it is a paid action and guests are anonymous.
* If a shared copy is genuinely bad, only staff can remove it from the admin panel; the next person to open the
  output then generates a fresh one for everybody.
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
from ...shared import throttle
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


# A person's own regenerated copy lives in user_outputs under the variant plus this tag. The plain variant there is
# taken by the copies made from the person's own documents, so the two never collide.
PERSONAL_TAG = "@mine"

# How often one account may regenerate. The daily generation limit is the hard cap on cost; these stop a script or a
# nervous double-click from burning it in a minute.
REGENERATE_PER_HOUR = 8
REGENERATE_SAME_OUTPUT_SECONDS = 20


def personal_variant(variant: str) -> str:
    return f"{variant}{PERSONAL_TAG}"


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

    if force and is_guest:
        raise AppError(403, "account_required", "Sign in to make your own version of this.")

    # Open what already exists: the person's own copy first, otherwise the shared one.
    with connection() as conn:
        mine = None if is_guest else repo.get_user_output(conn, user_id, video_id, kind, personal_variant(variant))
        shared = repo.get_output(conn, video_id, kind, variant)
    if not force:
        if mine is not None:
            return {**mine, "personal": True}
        if shared is not None:
            return shared
    elif shared is None:
        force = False   # nothing shared exists yet: this request simply makes the shared copy, like a first open

    with connection() as conn:
        result = jobs_repo.get_result(conn, video_id)
    if not result:
        raise AppError(409, "video_not_ready", "This video is still being processed.")

    if force:
        return _regenerate_for_user(user_id, video_id, kind, variant, result,
                                    {"difficulty": difficulty, "num_questions": num_questions})
    return _generate_shared(user_id, video_id, kind, variant, result,
                            {"difficulty": difficulty, "num_questions": num_questions}, is_guest)


def _generate_shared(user_id: str, video_id: str, kind: str, variant: str, result, params: Dict[str, Any],
                     is_guest: bool) -> Dict[str, Any]:
    """First open: generate the copy everyone with this video will share. If two people ask at once, one generates
    and the other waits and receives the same copy. An existing shared copy is never replaced here."""
    with _one_at_a_time(f"{video_id}:{kind}:{variant}"):
        with connection() as conn:   # another request may have finished while we waited
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
        content = _generate(kind, result["title"] or "Video", result["summary"], result["transcript"], params)
        if content.get("provider") == FALLBACK_LABEL:
            return content  # shown, but not stored
        with connection() as conn:
            return repo.put_output(conn, video_id, kind, variant, content, replace=False)


def _regenerate_for_user(user_id: str, video_id: str, kind: str, variant: str, result,
                         params: Dict[str, Any]) -> Dict[str, Any]:
    """"Make me a new one": generate again and keep the result for this person only."""
    throttle.check(f"regen:{user_id}", REGENERATE_PER_HOUR, 3600, what="regenerations")
    throttle.check(f"regen:{user_id}:{video_id}:{kind}:{variant}", 1, REGENERATE_SAME_OUTPUT_SECONDS,
                   what="regenerations of the same item")
    limit = get_settings().generation_daily_limit
    with _one_at_a_time(f"{user_id}:{video_id}:{kind}:{variant}:mine"):
        with connection() as conn:
            used = repo.bump_generation_usage(conn, user_id, limit)
        if used < 0:
            raise AppError(429, "generation_limit_reached",
                           f"You reached today's limit of {limit} generations. Opening existing "
                           "flashcards, quizzes, mind maps and slides still works.")
        content = _generate(kind, result["title"] or "Video", result["summary"], result["transcript"], params)
        if content.get("provider") == FALLBACK_LABEL:
            return content  # shown, but not stored (and the person's previous copy stays)
        with connection() as conn:
            repo.put_user_output(conn, user_id, video_id, kind, personal_variant(variant), content)
        return {**content, "personal": True}


def reset_personal(user_id: str, video_id: str, kind: str, difficulty: str = "medium", num_questions: int = 5) -> bool:
    """Drop the person's own copy so they see the shared one again. Free."""
    if kind not in repo.KINDS:
        raise AppError(404, "unknown_output", "Unknown output type.")
    variant = quiz_variant(difficulty, num_questions) if kind == "quiz" else ""
    with connection() as conn:
        return repo.delete_user_output(conn, user_id, video_id, kind, personal_variant(variant))
