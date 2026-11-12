"""Which files are accepted, and checks that a file really is what its name says."""
import unicodedata
import zipfile
from pathlib import Path
from typing import Dict

# extension -> (type we will report, a short label). The type comes from OUR table, never from the browser.
ALLOWED: Dict[str, str] = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".rtf": "application/rtf",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

VIDEO_TYPES: Dict[str, str] = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
    ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
}

OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"          # old binary Office files
ZIP_REQUIRED_PARTS = {
    ".docx": "word/document.xml", ".pptx": "ppt/presentation.xml", ".xlsx": "xl/workbook.xml",
}
ODF_TYPES = {".odt": b"application/vnd.oasis.opendocument.text", ".odp": b"application/vnd.oasis.opendocument.presentation",
             ".ods": b"application/vnd.oasis.opendocument.spreadsheet"}

# Protection against "zip bombs": a tiny file that expands to something enormous.
MAX_ZIP_ENTRIES = 5000
MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024
MAX_ZIP_RATIO = 200


def extension_of(name: str) -> str:
    return Path(name).suffix.lower()


def _keep(ch: str) -> bool:
    """Letters, combining marks (needed for Hindi and many other scripts), digits and a few symbols."""
    return unicodedata.category(ch)[0] in "LMN" or ch in " .()-[]_"


def safe_filename(name: str) -> str:
    """The base name only, with unsafe characters replaced, at most 120 characters of name."""
    base = Path((name or "").replace("\\", "/")).name
    stem, ext = Path(base).stem, Path(base).suffix.lower()
    stem = "".join(ch if _keep(ch) else "_" for ch in stem).strip(" .")[:120] or "file"
    return stem + ext


def zip_is_safe(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ZIP_ENTRIES:
                return False
            total = 0
            for entry in entries:
                total += entry.file_size
                if entry.file_size > 1024 * 1024 and entry.compress_size > 0 and entry.file_size / entry.compress_size > MAX_ZIP_RATIO:
                    return False
            return total <= MAX_ZIP_UNCOMPRESSED
    except (zipfile.BadZipFile, OSError):
        return False


def looks_like_text(head: bytes) -> bool:
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8-sig")
        return True
    except UnicodeDecodeError as exc:
        # A multi-byte character cut off at the end of the sample is fine.
        return exc.start >= len(head) - 4


def content_matches(path: Path, ext: str) -> bool:
    """Does the file's content fit its extension?"""
    with open(path, "rb") as handle:
        head = handle.read(65536)
    if ext == ".pdf":
        return b"%PDF-" in head[:1024]
    if ext in (".doc", ".ppt", ".xls"):
        return head.startswith(OLE_MAGIC)
    if ext in ZIP_REQUIRED_PARTS or ext in ODF_TYPES:
        if not head.startswith(b"PK\x03\x04") or not zip_is_safe(path):
            return False
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            if ext in ZIP_REQUIRED_PARTS:
                return ZIP_REQUIRED_PARTS[ext] in names
            return "mimetype" in names and archive.read("mimetype").strip() == ODF_TYPES[ext]
    if ext == ".rtf":
        return head.lstrip().startswith(b"{\\rtf")
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".gif":
        return head[:6] in (b"GIF87a", b"GIF89a")
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext in (".txt", ".md", ".csv"):
        return looks_like_text(head)
    return False


def video_content_matches(path: Path, ext: str) -> bool:
    """A light check that a video/audio upload is not something else renamed."""
    with open(path, "rb") as handle:
        head = handle.read(4096)
    if ext in (".mp4", ".mov", ".m4a"):
        return b"ftyp" in head[:32] or b"moov" in head[:64] or b"mdat" in head[:64] or b"wide" in head[:16]
    if ext in (".mkv", ".webm"):
        return head.startswith(b"\x1a\x45\xdf\xa3")
    if ext == ".avi":
        return head[:4] == b"RIFF" and head[8:12] == b"AVI "
    if ext == ".wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if ext == ".mp3":
        return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
    return False
