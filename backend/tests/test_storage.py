import httpx
import pytest

from summarizer.shared.storage import LocalFileStore, SupabaseFileStore, get_file_store
from conftest import set_env


def test_local_store_round_trip(tmp_path):
    store = LocalFileStore(tmp_path / "store")
    source = tmp_path / "in.bin"
    source.write_bytes(b"hello")
    store.save(source, "abc__lecture.mp4")
    out = tmp_path / "out.bin"
    store.fetch("abc__lecture.mp4", out)
    assert out.read_bytes() == b"hello"
    store.delete("abc__lecture.mp4")
    store.delete("abc__lecture.mp4")  # deleting twice is fine
    assert not (tmp_path / "store" / "abc__lecture.mp4").exists()


@pytest.mark.parametrize("key", ["../escape.mp4", "a/../../escape.mp4", "/etc/passwd", "..\\escape.mp4", "./x/../../escape.mp4"])
def test_local_store_cannot_leave_its_folder(tmp_path, key):
    store_dir = tmp_path / "inner" / "store"
    store = LocalFileStore(store_dir)
    source = tmp_path / "in.bin"
    source.write_bytes(b"x")
    store.save(source, key)
    written = [p for p in tmp_path.rglob("*") if p.is_file() and p != source]
    assert written, "the file should have been stored somewhere"
    assert all(store_dir.resolve() in p.resolve().parents for p in written)


@pytest.mark.parametrize("key", ["..", "", "/", "../.."])
def test_local_store_rejects_keys_with_no_usable_name(tmp_path, key):
    store = LocalFileStore(tmp_path / "store")
    source = tmp_path / "in.bin"
    source.write_bytes(b"x")
    with pytest.raises(ValueError):
        store.save(source, key)


def make_supabase_store(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return SupabaseFileStore("https://proj.supabase.co/", "service-key", "uploads", client)


def test_supabase_store_uses_the_storage_api(tmp_path):
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        if request.method == "GET":
            return httpx.Response(200, content=b"file-bytes")
        return httpx.Response(200, json={})

    store = make_supabase_store(handler)
    source = tmp_path / "in.bin"
    source.write_bytes(b"payload")
    store.save(source, "hash__My Lecture.mp4")
    store.fetch("hash__My Lecture.mp4", tmp_path / "out.bin")
    store.delete("hash__My Lecture.mp4")

    post, get, delete = seen
    assert (post.method, get.method, delete.method) == ("POST", "GET", "DELETE")
    assert str(post.url) == "https://proj.supabase.co/storage/v1/object/uploads/hash__My%20Lecture.mp4"
    assert post.headers["authorization"] == "Bearer service-key" and post.headers["apikey"] == "service-key"
    assert post.headers["x-upsert"] == "true" and post.content == b"payload"
    assert (tmp_path / "out.bin").read_bytes() == b"file-bytes"


def test_supabase_store_errors_are_raised_but_missing_delete_is_fine(tmp_path):
    store = make_supabase_store(lambda r: httpx.Response(404 if r.method == "DELETE" else 500))
    store.delete("gone.mp4")
    source = tmp_path / "in.bin"
    source.write_bytes(b"x")
    with pytest.raises(httpx.HTTPStatusError):
        store.save(source, "k.mp4")


def test_store_selection_from_settings(monkeypatch, tmp_path):
    assert isinstance(get_file_store(), LocalFileStore)
    set_env(monkeypatch, FILE_STORE="supabase")
    with pytest.raises(RuntimeError):
        get_file_store()
    set_env(monkeypatch, SUPABASE_URL="https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY="k")
    assert isinstance(get_file_store(), SupabaseFileStore)
