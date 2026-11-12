"""Where uploaded media is kept between the API and the worker.

`LocalFileStore` is for one machine (development). `SupabaseFileStore` keeps
files in a private Supabase Storage bucket, so the API and a separate (GPU)
worker machine can share them.
"""
import shutil
from typing import Optional
from abc import ABC, abstractmethod
from pathlib import Path
from urllib.parse import quote

import httpx

from ..core.config import get_settings


class FileStore(ABC):
    @abstractmethod
    def save(self, source: Path, key: str) -> None: ...

    @abstractmethod
    def fetch(self, key: str, dest: Path) -> None: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    def local_path(self, key: str) -> Optional[Path]:
        """The file on this machine, if the store is local."""
        return None

    def signed_url(self, key: str, seconds: int = 300, download_name: Optional[str] = None) -> Optional[str]:
        """A temporary direct address, if the store is remote."""
        return None


def _safe_key(key: str) -> str:
    parts = [p for p in key.replace("\\", "/").split("/") if p not in ("", ".", "..")]
    if not parts:
        raise ValueError("Invalid storage key.")
    return "/".join(parts)


class LocalFileStore(FileStore):
    def __init__(self, base: Path):
        self.base = Path(base)
        self.base.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.base / _safe_key(key)).resolve()
        if self.base.resolve() not in path.parents:
            raise ValueError("Invalid storage key.")
        return path

    def save(self, source: Path, key: str) -> None:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)

    def fetch(self, key: str, dest: Path) -> None:
        shutil.copyfile(self._path(key), dest)

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def local_path(self, key: str) -> Optional[Path]:
        path = self._path(key)
        return path if path.is_file() else None


class SupabaseFileStore(FileStore):
    def __init__(self, url: str, service_key: str, bucket: str, client: httpx.Client | None = None):
        self.base = f"{url.rstrip('/')}/storage/v1/object/{bucket}"
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        self.client = client or httpx.Client(timeout=600.0)

    def _url(self, key: str) -> str:
        return f"{self.base}/{quote(_safe_key(key))}"

    def save(self, source: Path, key: str) -> None:
        with open(source, "rb") as handle:
            response = self.client.post(self._url(key), content=handle,
                                        headers={**self.headers, "x-upsert": "true",
                                                 "Content-Type": "application/octet-stream"})
        response.raise_for_status()

    def fetch(self, key: str, dest: Path) -> None:
        with self.client.stream("GET", self._url(key), headers=self.headers) as response:
            response.raise_for_status()
            with open(dest, "wb") as out:
                for chunk in response.iter_bytes(1024 * 1024):
                    out.write(chunk)

    def signed_url(self, key: str, seconds: int = 300, download_name: Optional[str] = None) -> Optional[str]:
        root = self.base.split("/object/")[0]
        bucket = self.base.rsplit("/", 1)[-1]
        response = self.client.post(f"{root}/object/sign/{bucket}/{quote(_safe_key(key))}",
                                    json={"expiresIn": seconds}, headers=self.headers)
        response.raise_for_status()
        signed = response.json()["signedURL"]
        url = f"{root}{signed}" if signed.startswith("/") else signed
        if download_name:
            url += ("&" if "?" in url else "?") + "download=" + quote(download_name)
        return url

    def delete(self, key: str) -> None:
        response = self.client.delete(self._url(key), headers=self.headers)
        if response.status_code not in (200, 204, 404):
            response.raise_for_status()


def get_file_store() -> FileStore:
    settings = get_settings()
    if settings.file_store == "supabase":
        if not (settings.supabase_url and settings.supabase_service_role_key):
            raise RuntimeError("FILE_STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
        return SupabaseFileStore(settings.supabase_url, settings.supabase_service_role_key,
                                 settings.storage_bucket)
    return LocalFileStore(settings.data_dir / "uploads")
