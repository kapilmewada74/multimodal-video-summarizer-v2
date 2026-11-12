"""Reading playlist and video information from YouTube (no API key needed)."""
import logging
import re
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("summarizer.playlists")

MAX_IMPORT_ITEMS = 100
_PLAYLIST_RE = re.compile(
    r"^(?:https?://)?(?:www\.|m\.)?youtube\.com/(?:playlist|watch)\?(?:[^&#]*&)*list=([A-Za-z0-9_-]{10,64})(?:[&#].*)?$")
UNAVAILABLE_TITLES = {"[private video]", "[deleted video]", "[unavailable video]"}


def extract_playlist_id(url: str) -> Optional[str]:
    match = _PLAYLIST_RE.match((url or "").strip())
    return match.group(1) if match else None


def fetch_playlist(playlist_id: str) -> Dict[str, Any]:
    """Title and videos of a public playlist: {"title", "entries": [{"id","title","duration"}]}."""
    import yt_dlp

    options = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "skip_download": True,
               "playlistend": MAX_IMPORT_ITEMS, "socket_timeout": 20}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/playlist?list={playlist_id}", download=False)
    entries: List[Dict[str, Any]] = []
    seen = set()
    for entry in (info.get("entries") or [])[:MAX_IMPORT_ITEMS]:
        vid = (entry or {}).get("id")
        title = (entry or {}).get("title") or ""
        if not vid or not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid) or vid in seen or title.lower() in UNAVAILABLE_TITLES:
            continue
        seen.add(vid)
        entries.append({"id": vid, "title": title[:200], "duration": int(entry.get("duration") or 0) or None})
    return {"title": (info.get("title") or "YouTube playlist")[:120], "entries": entries}


def fetch_video_title(youtube_id: str, client: Optional[httpx.Client] = None) -> Optional[str]:
    """The video's title from YouTube's public oEmbed endpoint, or None."""
    try:
        response = (client or httpx).get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={youtube_id}", "format": "json"}, timeout=6.0)
        if response.status_code == 200:
            title = response.json().get("title")
            return str(title)[:200] if title else None
    except (httpx.HTTPError, ValueError):
        logger.info("Could not look up the title of a video.")
    return None
