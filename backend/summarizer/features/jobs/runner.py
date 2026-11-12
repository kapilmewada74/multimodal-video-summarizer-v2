"""Runs one ingest job from start to finish.

The external pieces (YouTube, Whisper, the AI providers) are passed in through
`PipelineDeps`, so the whole flow can be tested with fakes.
"""
import logging
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Tuple

from ...core.config import get_settings
from ...shared.storage import FileStore
from ..summaries.service import summarize_transcript
from ..transcripts import providers
from ..videos.youtube import extract_video_id
from . import repository as repo

logger = logging.getLogger("summarizer.runner")


class UserError(Exception):
    """A problem with the request itself (not worth retrying)."""


def _fetch_metadata(url: str) -> Tuple[str, int]:
    import yt_dlp

    class Quiet:
        def debug(self, msg): pass
        def info(self, msg): pass
        def warning(self, msg): pass
        def error(self, msg): logger.error("[yt-dlp] %s", msg)

    options = {"quiet": True, "no_warnings": True, "skip_download": True, "logger": Quiet(),
               "noplaylist": True}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)
    return info.get("title") or "YouTube Video", int(info.get("duration") or 0)


def _transcribe_youtube(url: str, job_id: str) -> str:
    video_path = providers.download_video(url, job_id)
    audio_path = None
    try:
        audio_path = providers.extract_audio(video_path, job_id)
        return providers.transcribe_audio(audio_path)
    finally:
        for leftover in (video_path, audio_path):
            if leftover and Path(leftover).exists():
                Path(leftover).unlink(missing_ok=True)


def _transcribe_file(path: Path, job_id: str) -> str:
    audio_path = providers.extract_audio(path, job_id)
    try:
        return providers.transcribe_audio(audio_path)
    finally:
        audio_path.unlink(missing_ok=True)


@dataclass
class PipelineDeps:
    fetch_metadata: Callable[[str], Tuple[str, int]] = _fetch_metadata
    fetch_captions: Callable[[str], Optional[str]] = providers.fetch_youtube_captions
    transcribe_youtube: Callable[[str, str], str] = _transcribe_youtube
    transcribe_file: Callable[[Path, str], str] = _transcribe_file
    summarize: Callable[[str], Tuple[str, str]] = summarize_transcript
    to_roman: Callable[[str], str] = providers.convert_to_english_script
    file_store: Optional[FileStore] = field(default=None)


def _progress(conn, job, step: int, name: str, progress: int, message: str) -> None:
    repo.update_job(conn, job["id"], step=step, step_name=name, progress=progress, message=message)


def process_job(conn, job: dict, deps: PipelineDeps) -> None:
    """Run a claimed job. Raises on failure; the worker decides about retries."""
    video_id = job["video_id"]

    video = repo.get_video(conn, video_id)
    if video and video["status"] == "ready":
        # Another worker finished the same video while this job was waiting.
        repo.update_job(conn, job["id"], status="completed", step=3, step_name="Complete",
                        progress=100, message="Loaded from the shared cache.", finished_at=_now(conn))
        return

    repo.set_video_status(conn, video_id, "processing")
    if job["source"] == "youtube":
        title, duration, transcript, provider = _run_youtube(conn, job, deps)
    else:
        title, duration, transcript, provider = _run_upload(conn, job, deps)

    if not transcript or not transcript.strip():
        raise UserError("No audible speech or transcript could be extracted from this video.")

    _progress(conn, job, 3, "Study Notes Generation", 75, "Generating structured study summary...")
    summary, engine = deps.summarize(transcript)
    if not summary.strip():
        raise RuntimeError("The AI produced an empty summary.")

    repo.save_result(conn, video_id, title=title, duration=duration, language=None,
                     transcript=transcript, provider=provider, summary=summary, engine=engine)
    repo.update_job(conn, job["id"], status="completed", step=3, step_name="Complete", progress=100,
                    message=f"Video successfully summarized with {engine}!", finished_at=_now(conn))


def _now(conn):
    return conn.execute("select now() n").fetchone()["n"]


def _run_youtube(conn, job, deps: PipelineDeps):
    url = job["source_ref"]
    _progress(conn, job, 1, "Connecting to YouTube", 15, "Connecting to YouTube and retrieving metadata...")
    title, duration = "YouTube Video", 0
    try:
        title, duration = deps.fetch_metadata(url)
    except Exception as exc:  # metadata is nice to have, not essential
        logger.warning("Metadata lookup failed: %s", type(exc).__name__)

    limit = get_settings().max_video_seconds
    if duration and duration > limit:
        raise UserError(f"This video is {duration // 60} minutes long. "
                        f"The maximum supported length is {limit // 60} minutes.")
    repo.set_video_status(conn, job["video_id"], "processing", title=title, duration_seconds=duration)

    _progress(conn, job, 2, "Checking Captions", 35, "Checking for official or auto-generated captions...")
    transcript, provider = None, "youtube-captions"
    try:
        transcript = deps.fetch_captions(url)
    except Exception as exc:
        logger.info("Caption fetch failed: %s", type(exc).__name__)

    if transcript and transcript.strip():
        _progress(conn, job, 2, "Formatting Transcript", 65, "Processing and formatting transcript...")
        transcript = deps.to_roman(transcript)
    else:
        provider = "whisper"
        _progress(conn, job, 2, "Speech Transcription", 40,
                  "No captions found. Transcribing the audio (this can take a few minutes)...")
        transcript = deps.transcribe_youtube(url, str(job["id"]))
    return title, duration, transcript, provider


def _run_upload(conn, job, deps: PipelineDeps):
    store = deps.file_store
    if store is None:
        raise RuntimeError("No file store is configured for uploads.")
    key = job["source_ref"]
    _progress(conn, job, 1, "Extracting Audio", 25, "Preparing the uploaded file...")

    work = Path(tempfile.mkdtemp(prefix="upload-", dir=_tmp_root()))
    try:
        local = work / Path(key).name
        store.fetch(key, local)
        _progress(conn, job, 2, "Speech Transcription", 50, "Transcribing speech from audio...")
        transcript = deps.transcribe_file(local, str(job["id"]))
    finally:
        shutil.rmtree(work, ignore_errors=True)
        try:
            store.delete(key)  # the original is no longer needed
        except Exception as exc:
            logger.warning("Could not delete upload %s: %s", key, type(exc).__name__)
    title = Path(key).name.split("__", 1)[-1] if "__" in Path(key).name else Path(key).stem
    return title, 0, transcript, "whisper"


def _tmp_root() -> str:
    root = get_settings().data_dir / "tmp"
    root.mkdir(parents=True, exist_ok=True)
    return str(root)


def youtube_id_for(url: str) -> str:
    return extract_video_id(url)
