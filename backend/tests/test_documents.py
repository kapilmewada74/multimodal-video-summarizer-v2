"""Documents: upload, validation, text extraction, attach/detach, secure downloads, limits."""
import io
import time
import uuid

import pytest

import samples
from apiutil import ready_video
from conftest import set_env
from summarizer.shared import signing


def upload(api, user, name, content, video_id=None, **kwargs):
    data = {"video_id": video_id} if video_id else None
    return api.client.post("/api/documents", headers=user.headers, files={"file": (name, io.BytesIO(content), "application/octet-stream")},
                           data=data, **kwargs)


def stored_files(tmp_path):
    root = tmp_path / "data" / "uploads" / "documents"
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


GOOD = [
    ("report.pdf", lambda: samples.pdf("Alpha PDF words"), "application/pdf", "Alpha PDF words"),
    ("essay.docx", lambda: samples.docx("Beta Word words", "gamma cell"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Beta Word words"),
    ("slides.pptx", lambda: samples.pptx("Delta Slide words"), "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Delta Slide words"),
    ("notes.txt", lambda: samples.TXT, "text/plain", "Plain text notes"),
    ("readme.md", lambda: samples.MD, "text/markdown", "Heading"),
    ("data.csv", lambda: samples.CSV, "text/csv", "a,b"),
    ("sheet.xlsx", samples.xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Quarterly revenue | 42"),
    ("memo.odt", samples.odt, "application/vnd.oasis.opendocument.text", "Odt paragraph words"),
    ("memo.rtf", lambda: samples.RTF, "application/rtf", "Hello rtf world"),
]
NO_TEXT = [
    ("empty.xlsx", lambda: samples.xlsx(text=False), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ("old.doc", lambda: samples.OLE, "application/msword"),
    ("old.ppt", lambda: samples.OLE, "application/vnd.ms-powerpoint"),
    ("old.xls", lambda: samples.OLE, "application/vnd.ms-excel"),
    ("empty.odt", lambda: samples.odt(text=False), "application/vnd.oasis.opendocument.text"),
    ("pic.png", lambda: samples.PNG, "image/png"),
    ("pic.jpg", lambda: samples.JPG, "image/jpeg"),
    ("pic.jpeg", lambda: samples.JPG, "image/jpeg"),
    ("pic.gif", lambda: samples.GIF, "image/gif"),
    ("pic.webp", lambda: samples.WEBP, "image/webp"),
]


@pytest.mark.parametrize("name,build,mime,expected", GOOD)
def test_documents_with_text_are_stored_and_read(api, name, build, mime, expected):
    user = api.user()
    res = upload(api, user, name, build())
    assert res.status_code == 201, res.text
    doc = res.json()
    assert doc["filename"] == name and doc["mime"] == mime and doc["has_text"] is True and doc["video_id"] is None
    text = api.client.get(f"/api/documents/{doc['id']}/text", headers=user.headers).json()["text"]
    assert expected in text


def test_word_tables_are_read_too(api):
    user = api.user()
    doc = upload(api, user, "t.docx", samples.docx("p", "table cell text")).json()
    assert "table cell text" in api.client.get(f"/api/documents/{doc['id']}/text", headers=user.headers).json()["text"]


@pytest.mark.parametrize("name,build,mime", NO_TEXT)
def test_documents_we_do_not_read_are_still_kept(api, name, build, mime):
    user = api.user()
    res = upload(api, user, name, build())
    assert res.status_code == 201, res.text
    assert res.json()["mime"] == mime and res.json()["has_text"] is False and res.json()["text_status"] == "none"


@pytest.mark.parametrize("name", ["virus.exe", "page.html", "image.svg", "script.js", "run.sh", "archive.zip", "shell.php",
                                  "noextension", "double.pdf.exe", "macro.docm", ".pdf", "photo.heic", "movie.mp4"])
def test_unsupported_types_are_refused(api, name, tmp_path):
    user = api.user()
    res = upload(api, user, name, b"some bytes here")
    assert res.status_code == 400 and res.json()["code"] == "unsupported_format"
    assert stored_files(tmp_path) == []


@pytest.mark.parametrize("name,content", [
    ("fake.pdf", samples.EXE), ("fake.pdf", samples.HTML), ("fake.png", samples.TXT), ("fake.jpg", samples.PNG),
    ("fake.docx", samples.pdf()), ("fake.docx", samples.xlsx()), ("fake.pptx", samples.docx()), ("fake.xlsx", samples.docx()),
    ("fake.doc", samples.TXT), ("fake.rtf", samples.TXT), ("fake.gif", samples.JPG), ("fake.webp", samples.PNG),
    ("fake.txt", b"text\x00with\x00nulls"), ("fake.txt", samples.EXE), ("fake.csv", b"\xff\xfe\x00\x01 binary"),
    ("fake.odt", samples.docx()), ("fake.docx", b"PK\x03\x04 not really a zip"),
])
def test_files_that_do_not_match_their_name_are_refused(api, name, content, tmp_path):
    user = api.user()
    res = upload(api, user, name, content)
    assert res.status_code == 400 and res.json()["code"] == "content_mismatch"
    assert stored_files(tmp_path) == []
    assert api.sql("select count(*) from documents")[0][0] == 0


def test_a_zip_bomb_is_refused(api):
    res = upload(api, api.user(), "bomb.docx", samples.zip_bomb_docx())
    assert res.status_code == 400 and res.json()["code"] == "content_mismatch"


def test_damaged_documents_are_kept_but_marked(api):
    user = api.user()
    res = upload(api, user, "broken.pdf", b"%PDF-1.4\nthis is not really a pdf body")
    assert res.status_code == 201 and res.json()["text_status"] in ("failed", "none")
    assert res.json()["has_text"] is False


def test_empty_and_oversized_files(api, tmp_path, monkeypatch):
    user = api.user()
    assert upload(api, user, "empty.txt", b"").json()["code"] == "empty_file"
    set_env(monkeypatch, MAX_DOCUMENT_MB="0")
    assert upload(api, user, "big.txt", b"x" * 10).status_code == 413
    assert stored_files(tmp_path) == [] and not list((tmp_path / "data" / "tmp").glob("*"))


def test_filenames_cannot_escape_or_inject(api, tmp_path):
    user = api.user()
    res = upload(api, user, "../../etc/passwd.txt", samples.TXT)
    assert res.status_code == 201 and res.json()["filename"] == "passwd.txt"
    res = upload(api, user, "..\\..\\evil<script>.md", samples.MD)
    assert res.status_code == 201 and "<" not in res.json()["filename"] and "\\" not in res.json()["filename"]
    for path in stored_files(tmp_path):
        assert path.parent.name == user.id  # always under the user's own folder, with a generated name
        assert len(path.stem) == 32
    assert not (tmp_path / "passwd.txt").exists() and not (tmp_path.parent / "passwd.txt").exists()


def test_unicode_filenames(api):
    user = api.user()
    res = upload(api, user, "हिन्दी नोट्स 📝.txt", samples.TXT)
    assert res.status_code == 201 and res.json()["filename"].endswith(".txt") and "हिन्दी" in res.json()["filename"]


# ------------------------------------------------------------- attach and detach

def test_attach_when_uploading_and_list_by_video(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    attached = upload(api, user, "slides.pptx", samples.pptx(), video_id=video).json()
    standalone = upload(api, user, "loose.txt", samples.TXT).json()
    assert attached["video_id"] == video and standalone["video_id"] is None

    by_video = api.client.get(f"/api/documents?video_id={video}", headers=user.headers).json()
    assert [d["id"] for d in by_video["items"]] == [attached["id"]] and by_video["total"] == 1
    alone = api.client.get("/api/documents?standalone=true", headers=user.headers).json()
    assert [d["id"] for d in alone["items"]] == [standalone["id"]]
    everything = api.client.get("/api/documents", headers=user.headers).json()
    assert everything["total"] == 2 and {d["id"] for d in everything["items"]} == {attached["id"], standalone["id"]}


def test_attach_and_detach_later(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    doc = upload(api, user, "loose.txt", samples.TXT).json()
    moved = api.client.patch(f"/api/documents/{doc['id']}", headers=user.headers, json={"video_id": video}).json()
    assert moved["video_id"] == video
    back = api.client.patch(f"/api/documents/{doc['id']}", headers=user.headers, json={"video_id": None}).json()
    assert back["video_id"] is None


def test_you_cannot_attach_to_a_video_you_do_not_have(api, tmp_path):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    assert upload(api, bob, "a.txt", samples.TXT, video_id=video).status_code == 404
    assert upload(api, bob, "a.txt", samples.TXT, video_id="not-a-uuid").status_code == 404
    doc = upload(api, bob, "b.txt", samples.MD).json()
    assert api.client.patch(f"/api/documents/{doc['id']}", headers=bob.headers, json={"video_id": video}).status_code == 404
    assert api.client.get(f"/api/documents?video_id={video}", headers=bob.headers).json()["items"] == []
    assert api.client.get("/api/documents?video_id=nope", headers=bob.headers).status_code == 404


def test_rename_keeps_the_real_extension(api):
    user = api.user()
    doc = upload(api, user, "old.pdf", samples.pdf()).json()
    new = api.client.patch(f"/api/documents/{doc['id']}", headers=user.headers, json={"filename": "Chapter 1 notes"}).json()
    assert new["filename"] == "Chapter 1 notes.pdf"
    sneaky = api.client.patch(f"/api/documents/{doc['id']}", headers=user.headers, json={"filename": "run.exe"}).json()
    assert sneaky["filename"].endswith(".pdf") and "exe" not in sneaky["filename"].rsplit(".", 1)[-1]
    assert api.client.patch(f"/api/documents/{doc['id']}", headers=user.headers, json={"filename": ""}).status_code == 422


def test_the_same_file_cannot_be_added_twice_to_the_same_place(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert upload(api, user, "a.txt", samples.TXT, video_id=video).status_code == 201
    again = upload(api, user, "renamed.txt", samples.TXT, video_id=video)
    assert again.status_code == 409 and again.json()["code"] == "already_uploaded"
    assert len(stored_files(tmp_path)) == 1  # the duplicate file was not kept
    assert upload(api, user, "a.txt", samples.TXT).status_code == 201          # standalone copy is fine
    other = ready_video(api, user, tmp_path, 2)
    assert upload(api, user, "a.txt", samples.TXT, video_id=other).status_code == 201
    assert upload(api, api.user(), "a.txt", samples.TXT).status_code == 201     # another user too


def test_moving_a_document_onto_a_video_that_already_has_the_file_is_refused(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    upload(api, user, "a.txt", samples.TXT, video_id=video)
    loose = upload(api, user, "a.txt", samples.TXT).json()
    res = api.client.patch(f"/api/documents/{loose['id']}", headers=user.headers, json={"video_id": video})
    assert res.status_code == 409


def test_a_removed_video_leaves_its_documents_standalone(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    doc = upload(api, user, "a.txt", samples.TXT, video_id=video).json()
    api.sql("delete from videos where id = %s", (video,))
    items = api.client.get("/api/documents?standalone=true", headers=user.headers).json()["items"]
    assert [d["id"] for d in items] == [doc["id"]]


# ----------------------------------------------------------- list, privacy, storage

def test_documents_are_private(api):
    alice, bob = api.user(), api.user()
    doc = upload(api, alice, "secret.pdf", samples.pdf("Top secret words")).json()
    assert api.client.get("/api/documents", headers=bob.headers).json()["items"] == []
    for method, path in [("get", f"/api/documents/{doc['id']}/text"), ("get", f"/api/documents/{doc['id']}/download-url"),
                         ("delete", f"/api/documents/{doc['id']}")]:
        assert getattr(api.client, method)(path, headers=bob.headers).status_code == 404, path
    assert api.client.patch(f"/api/documents/{doc['id']}", headers=bob.headers, json={"filename": "x"}).status_code == 404
    assert api.sql("select count(*) from documents")[0][0] == 1


def test_list_pagination_and_newest_first(api):
    user = api.user()
    for i in range(5):
        upload(api, user, f"n{i}.txt", f"note {i}".encode())
    page = api.client.get("/api/documents?limit=2&offset=0", headers=user.headers).json()
    assert page["total"] == 5 and [d["filename"] for d in page["items"]] == ["n4.txt", "n3.txt"]
    assert len(api.client.get("/api/documents?limit=2&offset=4", headers=user.headers).json()["items"]) == 1
    for bad in ("limit=0", "limit=201", "offset=-1"):
        assert api.client.get(f"/api/documents?{bad}", headers=user.headers).status_code == 422


def test_list_never_exposes_internal_details(api):
    user = api.user()
    upload(api, user, "a.pdf", samples.pdf("hidden text"))
    raw = api.client.get("/api/documents", headers=user.headers).text
    assert "storage_key" not in raw and "sha256" not in raw and "hidden text" not in raw and "documents/" not in raw


def test_storage_summary(api):
    user = api.user()
    assert api.client.get("/api/me/storage", headers=user.headers).json()["used_bytes"] == 0
    upload(api, user, "a.txt", b"x" * 1000)
    info = api.client.get("/api/me/storage", headers=user.headers).json()
    assert info["used_bytes"] == 1000 and info["document_count"] == 1
    assert info["quota_bytes"] == 2048 * 1024 * 1024 and info["max_document_bytes"] == 25 * 1024 * 1024


def test_storage_quota_blocks_new_files_and_is_freed_by_deleting(api, monkeypatch):
    set_env(monkeypatch, USER_STORAGE_QUOTA_MB="1")
    user = api.user()
    first = upload(api, user, "a.txt", b"a" * 600_000)
    assert first.status_code == 201
    full = upload(api, user, "b.txt", b"b" * 600_000)
    assert full.status_code == 413 and full.json()["code"] == "storage_full"
    api.client.delete(f"/api/documents/{first.json()['id']}", headers=user.headers)
    assert upload(api, user, "b.txt", b"b" * 600_000).status_code == 201
    assert upload(api, api.user(), "a.txt", b"a" * 600_000).status_code == 201  # other users have their own quota


def test_document_count_limit(api, monkeypatch):
    set_env(monkeypatch, MAX_DOCUMENTS_PER_USER="2")
    user = api.user()
    assert upload(api, user, "1.txt", b"one").status_code == 201
    assert upload(api, user, "2.txt", b"two").status_code == 201
    res = upload(api, user, "3.txt", b"three")
    assert res.status_code == 409 and res.json()["code"] == "too_many_documents"


# ---------------------------------------------------------------- downloads

def test_download_returns_the_exact_file_as_an_attachment(api):
    user = api.user()
    content = samples.pdf("Download me")
    doc = upload(api, user, "Report 1.pdf", content).json()
    link = api.client.get(f"/api/documents/{doc['id']}/download-url", headers=user.headers).json()
    assert link["expires_in"] == 600 and "token=" in link["url"]
    res = api.client.get(link["url"])  # no login header: the temporary token is the proof
    assert res.status_code == 200 and res.content == content
    assert res.headers["content-type"].startswith("application/pdf")
    assert res.headers["content-disposition"].startswith("attachment;") and "Report_1.pdf" in res.headers["content-disposition"]
    assert res.headers["x-content-type-options"] == "nosniff" and res.headers["cache-control"] == "private, no-store"


def test_download_with_unicode_name_has_a_safe_header(api):
    user = api.user()
    doc = upload(api, user, "हिन्दी.txt", samples.TXT).json()
    url = api.client.get(f"/api/documents/{doc['id']}/download-url", headers=user.headers).json()["url"]
    res = api.client.get(url)
    assert res.status_code == 200 and "filename*=UTF-8''" in res.headers["content-disposition"]


def test_download_needs_a_valid_token(api):
    user, other = api.user(), api.user()
    doc = upload(api, user, "a.txt", samples.TXT).json()
    other_doc = upload(api, other, "b.txt", samples.MD).json()
    base = f"/api/documents/{doc['id']}/file"
    assert api.client.get(base).status_code == 403
    assert api.client.get(base + "?token=").status_code == 403
    assert api.client.get(base + "?token=garbage").status_code == 403
    good = signing.sign("document-download", doc["id"])
    assert api.client.get(f"{base}?token={good}").status_code == 200
    assert api.client.get(f"{base}?token={good[:-2]}ab").status_code == 403                      # tampered
    expired = signing.sign("document-download", doc["id"], ttl_seconds=-5)
    assert api.client.get(f"{base}?token={expired}").status_code == 403                           # expired
    assert api.client.get(f"/api/documents/{other_doc['id']}/file?token={good}").status_code == 403  # token is for one file only
    wrong_purpose = signing.sign("upload-stream", doc["id"])
    assert api.client.get(f"{base}?token={wrong_purpose}").status_code == 403                     # and one purpose only
    assert api.client.get("/api/documents/not-a-uuid/file?token=x").status_code == 403


def test_html_is_never_served_in_a_way_a_browser_would_run(api):
    """Even if a hostile file got stored, it is only ever offered as a download."""
    user = api.user()
    doc = upload(api, user, "notes.md", b"# Title\n<script>alert(1)</script>").json()
    url = api.client.get(f"/api/documents/{doc['id']}/download-url", headers=user.headers).json()["url"]
    res = api.client.get(url)
    assert res.headers["content-disposition"].startswith("attachment") and res.headers["content-type"].startswith("text/markdown")
    assert res.headers["x-content-type-options"] == "nosniff"


def test_deleting_removes_the_row_and_the_file(api, tmp_path):
    user = api.user()
    doc = upload(api, user, "a.txt", samples.TXT).json()
    assert len(stored_files(tmp_path)) == 1
    assert api.client.delete(f"/api/documents/{doc['id']}", headers=user.headers).status_code == 204
    assert stored_files(tmp_path) == [] and api.sql("select count(*) from documents")[0][0] == 0
    assert api.client.delete(f"/api/documents/{doc['id']}", headers=user.headers).status_code == 404
    assert api.client.delete("/api/documents/not-a-uuid", headers=user.headers).status_code == 404


def test_a_file_that_goes_missing_gives_a_clear_error(api, tmp_path):
    user = api.user()
    doc = upload(api, user, "a.txt", samples.TXT).json()
    url = api.client.get(f"/api/documents/{doc['id']}/download-url", headers=user.headers).json()["url"]
    for path in stored_files(tmp_path):
        path.unlink()
    assert api.client.get(url).status_code in (404, 500) and "Traceback" not in api.client.get(url).text


def test_every_document_endpoint_needs_a_session(api):
    for method, path in [("post", "/api/documents"), ("get", "/api/documents"), ("get", "/api/me/storage"),
                         ("patch", f"/api/documents/{uuid.uuid4()}"), ("delete", f"/api/documents/{uuid.uuid4()}"),
                         ("get", f"/api/documents/{uuid.uuid4()}/text"), ("get", f"/api/documents/{uuid.uuid4()}/download-url")]:
        assert getattr(api.client, method)(path).status_code == 401, path


def test_signed_tokens_expire_by_the_clock():
    now = time.time()
    token = signing.sign("document-download", "abc", ttl_seconds=60, now=now)
    assert signing.verify("document-download", "abc", token, now=now + 59)
    assert not signing.verify("document-download", "abc", token, now=now + 61)
    assert not signing.verify("document-download", "abd", token, now=now)
    for junk in ("", "x", "1.2.3", None):
        assert not signing.verify("document-download", "abc", junk, now=now)


def test_more_formats_are_read_for_text(api):
    user = api.user()
    texts = {}
    for name, content in (("a.xlsx", samples.xlsx()), ("b.odt", samples.odt()), ("c.rtf", samples.RTF)):
        doc = upload(api, user, name, content).json()
        texts[name] = api.client.get(f"/api/documents/{doc['id']}/text", headers=user.headers).json()["text"]
    assert "Net margin" in texts["a.xlsx"] and "Sheet 1" in texts["a.xlsx"]
    assert "Second odt line" in texts["b.odt"] and "Odt paragraph words" in texts["b.odt"].splitlines()[0]
    assert "Second rtf line" in texts["c.rtf"] and "Arial" not in texts["c.rtf"] and "\\par" not in texts["c.rtf"]
