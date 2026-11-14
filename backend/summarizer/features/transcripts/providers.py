"""Getting text out of a video: YouTube captions, or speech recognition.

Heavy libraries (faster-whisper, yt-dlp) are imported only when needed so the
API starts quickly and tests do not need them.
"""
import logging
import subprocess
import threading
from pathlib import Path
from typing import Optional

from ...core.config import get_settings
from ..videos.youtube import extract_video_id

logger = logging.getLogger("summarizer.transcripts")

FFMPEG_TIMEOUT_SECONDS = 60 * 60
CAPTION_LANGUAGES = ["en", "en-US", "en-GB", "hi", "hi-IN"]

_model = None
_model_lock = threading.Lock()
_transcribe_lock = threading.Lock()  # one transcription at a time per process


def media_dirs():
    base = get_settings().data_dir
    downloads, audio = base / "downloads", base / "audio"
    downloads.mkdir(parents=True, exist_ok=True)
    audio.mkdir(parents=True, exist_ok=True)
    return downloads, audio


def _join_snippets(snippets) -> str:
    parts = []
    for item in snippets:
        text = item["text"] if isinstance(item, dict) else item.text
        if text and text.strip():
            parts.append(text.strip())
    return " ".join(parts).strip()


def fetch_youtube_captions(url: str) -> Optional[str]:
    """Return the video's existing captions, or None if there are none."""
    from youtube_transcript_api import YouTubeTranscriptApi

    video_id = extract_video_id(url)
    try:
        api = YouTubeTranscriptApi()
        try:
            text = _join_snippets(api.fetch(video_id, languages=CAPTION_LANGUAGES))
            if text:
                return text
        except Exception as exc:
            logger.info("Direct caption fetch unavailable: %s", type(exc).__name__)

        try:
            available = api.list(video_id)
            for language in CAPTION_LANGUAGES:
                try:
                    text = _join_snippets(available.find_transcript([language]).fetch())
                    if text:
                        return text
                except Exception:
                    continue
            # Any other available language is better than none.
            text = _join_snippets(next(iter(available)).fetch())
            if text:
                return text
        except Exception as exc:
            logger.info("Could not list captions: %s", type(exc).__name__)
    except Exception as exc:
        logger.info("Caption service unavailable: %s", type(exc).__name__)
    return None


def download_video(url: str, job_id: str) -> Path:
    """Download a small, low-resolution copy (only the audio is needed)."""
    import yt_dlp

    downloads, _ = media_dirs()
    template = str(downloads / f"youtube_video_{job_id}.%(ext)s")
    options = {
        "format": ("bestvideo[height=144]+bestaudio/best[height=144]/"
                   "bestvideo[height<=144]+bestaudio/best[height<=144]/best"),
        "outtmpl": template,
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)

    stem = Path(filename).with_suffix("")
    for candidate in (stem.with_suffix(".mp4"), Path(filename),
                      stem.with_suffix(".mkv"), stem.with_suffix(".webm"), stem.with_suffix(".mov")):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("The downloaded video could not be located.")


class UnsupportedMedia(ValueError):
    """The file is not one of the audio/video containers we accept (whatever its name says)."""


# ffprobe names a container with a comma-separated list, for example "mov,mp4,m4a,3gp,3g2,mj2" or "matroska,webm".
_ALLOWED_CONTAINERS = {"mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm", "avi", "mp3", "wav"}
PROBE_TIMEOUT_SECONDS = 30


def check_media_container(input_file: Path) -> None:
    """Refuse anything that is not really a plain audio/video file.

    The file name is chosen by the uploader, and ffmpeg decides what a file is from its CONTENT. A crafted playlist
    named "talk.mp4" can make ffmpeg open other local files or web addresses (reading the server's files, or calling
    internal services). So the container is checked first, and ffmpeg is also told it may only open local files."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-protocol_whitelist", "file", "-print_format", "default=noprint_wrappers=1:nokey=1",
             "-show_entries", "format=format_name", "-i", str(input_file)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=PROBE_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        raise UnsupportedMedia("The file could not be read in time.")
    names = {name.strip() for name in (result.stdout or "").strip().split(",") if name.strip()}
    if result.returncode != 0 or not names or not names <= _ALLOWED_CONTAINERS:
        raise UnsupportedMedia("This is not a supported audio or video file.")


def extract_audio(input_file: Path, job_id: str) -> Path:
    """Convert any media file to 16 kHz mono WAV for speech recognition."""
    check_media_container(input_file)
    _, audio_dir = media_dirs()
    output = audio_dir / f"audio_{job_id}.wav"
    result = subprocess.run(
        ["ffmpeg", "-y", "-nostdin", "-protocol_whitelist", "file", "-i", str(input_file), "-vn", "-acodec", "pcm_s16le",
         "-ar", "16000", "-ac", "1", str(output)],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        timeout=FFMPEG_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Audio extraction failed: {result.stderr.strip()[-200:]}")
    return output


def _whisper_settings():
    import os
    try:
        import ctranslate2
        cuda = ctranslate2.get_cuda_device_count() > 0
    except Exception:
        cuda = False
    name = os.getenv("WHISPER_MODEL", "small")
    return name, ("cuda" if cuda else "cpu"), ("float16" if cuda else "int8")


def load_whisper():
    """The speech-recognition model, loaded once per process."""
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel

            name, device, compute = _whisper_settings()
            logger.info("Loading Whisper '%s' on %s (%s).", name, device, compute)
            _model = WhisperModel(name, device=device, compute_type=compute)
        return _model


def convert_to_english_script(transcript: str) -> str:
    """Convert Hindi (Devanagari) text to Roman letters; English is unchanged."""
    from indic_transliteration import sanscript

    return sanscript.transliterate(transcript, sanscript.DEVANAGARI, sanscript.ITRANS)


def _collect(segments) -> str:
    return " ".join(s.text.strip() for s in segments if s.text and s.text.strip()).strip()


def transcribe_audio(audio_path: Path) -> str:
    """Speech to text. Languages other than English and Hindi are translated
    to English."""
    model = load_whisper()
    with _transcribe_lock:
        segments, info = model.transcribe(str(audio_path), beam_size=5, vad_filter=True, task="transcribe")
        transcript = _collect(segments)
        if not transcript:
            raise RuntimeError("Speech recognition produced an empty transcript.")
        if info.language not in ("en", "hi"):
            segments, _ = model.transcribe(str(audio_path), beam_size=5, vad_filter=True, task="translate")
            transcript = _collect(segments)
            if not transcript:
                raise RuntimeError("English translation is empty.")
    return convert_to_english_script(transcript)
