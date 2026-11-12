"""Receiving an uploaded file safely: streamed to a temporary file, size-limited, hashed."""
import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from fastapi import UploadFile

from ..core.config import get_settings
from ..core.errors import AppError

CHUNK_BYTES = 1024 * 1024


@dataclass
class ReceivedFile:
    path: Path
    size: int
    sha256: str

    def discard(self) -> None:
        self.path.unlink(missing_ok=True)


async def receive(file: UploadFile, max_bytes: int, suffix: str = "") -> ReceivedFile:
    """Copy the upload to a temporary file. Refuses empty files and files over `max_bytes`.
    The caller must call `.discard()` when done (also on errors)."""
    tmp_dir = get_settings().data_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="upload-", suffix=suffix, dir=tmp_dir)
    path, digest, written = Path(name), hashlib.sha256(), 0
    try:
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await file.read(CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise AppError(413, "file_too_large",
                                   f"File is too large. The maximum size is {max_bytes // (1024 * 1024)} MB.")
                digest.update(chunk)
                out.write(chunk)
        if written == 0:
            raise AppError(400, "empty_file", "The uploaded file is empty.")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return ReceivedFile(path, written, digest.hexdigest())
