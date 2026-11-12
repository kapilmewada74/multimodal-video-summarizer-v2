"""YouTube link checks."""
import re
from urllib.parse import parse_qs, urlparse


def is_valid_youtube_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    url = url.strip()
    patterns = [
        r'^(https?://)?(www\.|m\.)?youtube\.com/watch\?(?:[^&]*&)*v=[\w-]{11}(?:[&?#].*)?$',
        r'^(https?://)?(www\.)?youtu\.be/[\w-]{11}(?:[?&#].*)?$',
        r'^(https?://)?(www\.)?youtube\.com/shorts/[\w-]{11}(?:[?&#].*)?$',
        r'^(https?://)?(www\.)?youtube\.com/live/[\w-]{11}(?:[?&#].*)?$',
        r'^(https?://)?(www\.)?youtube\.com/embed/[\w-]{11}(?:[?&#].*)?$'
    ]
    return any(re.match(p, url) for p in patterns)


def extract_video_id(url):

    parsed = urlparse(url)
    host = parsed.netloc.lower().split(":")[0]

    if host == "youtu.be" or host.endswith(".youtu.be"):
        video_id = parsed.path.strip("/").split("/")[0]

    elif host == "youtube.com" or host.endswith(".youtube.com"):

        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]

        elif parsed.path.startswith(("/shorts/", "/embed/", "/live/")):
            parts = parsed.path.strip("/").split("/")
            video_id = parts[1] if len(parts) > 1 else ""

        else:
            video_id = ""

    else:
        raise ValueError("Please provide a valid YouTube URL.")

    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ValueError("Could not extract a valid YouTube video ID.")

    return video_id
