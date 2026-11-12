import re
from urllib.parse import quote


def safe_download_header(title: str, extension: str) -> str:
    """Content-Disposition that is safe for any title.

    HTTP headers are latin-1 only, so non-ASCII titles (for example Hindi) are
    sent with the RFC 5987 `filename*` form plus an ASCII fallback. Control
    characters and quotes are removed so a title cannot inject headers.
    """
    cleaned = re.sub(r"[\x00-\x1f\x7f\"\\/:*?<>|]", "", title or "").strip()
    cleaned = re.sub(r"\s+", "_", cleaned)[:100] or "download"
    ascii_name = cleaned.encode("ascii", "ignore").decode("ascii").strip("_.") or "download"
    return (f'attachment; filename="{ascii_name}.{extension}"; '
            f"filename*=UTF-8''{quote(cleaned)}.{extension}")
