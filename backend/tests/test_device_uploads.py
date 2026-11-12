"""Videos uploaded from the user's device into a playlist: storage, playback, summarize hand-off, cleanup."""
import io
import uuid

import pytest

import samples
from apiutil import make_deps
from conftest import set_env
from summarizer.features.jobs import worker
from summarizer.features.playlists import repository as playlist_repo
from summarizer.shared import signing

VIDEO_FILES = [
    ("clip.mp4", samples.MP4, "video/mp4"), ("clip.mov", samples.MOV, "video/quicktime"),
    ("clip.mkv", samples.MKV, "video/x-matroska"), ("clip.webm", samples.MKV, "video/webm"),
    ("clip.avi", samples.AVI, "video/x-msvideo"), ("talk.wav", samples.WAV, "audio/wav"),
    ("talk.mp3", samples.MP3, "audio/mpeg"), ("talk.m4a", samples.MP4, "audio/mp4"),
]


def playlist(api, user, title="Uploads"):
    return api.client.post("/api/playlists", headers=user.headers, json={"title": title}).json()["id"]


def upload_video(api, user, pid, name="lecture.mp4", content=samples.MP4):
    return api.client.post(f"/api/playlists/{pid}/uploads", headers=user.headers, files={"file": (name, io.BytesIO(content), "video/mp4")})


def kept_files(tmp_path):
    root = tmp_path / "data" / "uploads" / "kept-videos"
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


def items(api, user, pid):
    return api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()["items"]


@pytest.mark.parametrize("name,content,mime", VIDEO_FILES)
def test_every_supported_format_is_accepted(api, name, content, mime):
    user = api.user()
    res = upload_video(api, user, playlist(api, user), name, content)
    assert res.status_code == 201, res.text
    assert res.json()["title"] == name and res.json()["kind"] == "device_upload"
    assert api.sql("select mime from video_uploads")[0][0] == mime


def test_the_upload_becomes_a_playlist_item_without_using_a_daily_video(api, tmp_path):
    user = api.user()
    pid = playlist(api, user)
    res = upload_video(api, user, pid, "Physics Lecture 3.mp4")
    item = res.json()
    assert item["status"] == "uploaded" and item["youtube_id"] is None and item["video_id"] is None
    assert item["upload_id"] and item["size_bytes"] == len(samples.MP4) and item["completed"] is False
    assert [i["id"] for i in items(api, user, pid)] == [item["id"]]
    assert len(kept_files(tmp_path)) == 1
    assert api.client.get("/api/me/usage", headers=user.headers).json()["used"] == 0
    assert api.sql("select count(*) from jobs")[0][0] == 0
    assert api.client.get("/api/playlists", headers=user.headers).json()["items"][0]["item_count"] == 1


def test_uploaded_items_keep_their_order_and_can_be_reordered(api):
    user = api.user()
    pid = playlist(api, user)
    ids = [upload_video(api, user, pid, f"v{i}.mp4", samples.MP4 + bytes([i])).json()["id"] for i in range(3)]
    assert [i["id"] for i in items(api, user, pid)] == ids
    res = api.client.patch(f"/api/playlists/{pid}/items/{ids[2]}/move", headers=user.headers, json={"after_id": None, "before_id": ids[0]})
    assert res.status_code == 204 and [i["id"] for i in items(api, user, pid)] == [ids[2], ids[0], ids[1]]


@pytest.mark.parametrize("name,content", [
    ("clip.exe", samples.EXE), ("clip.html", samples.HTML), ("clip.pdf", samples.pdf()), ("clip", samples.MP4), ("clip.flv", samples.MP4),
])
def test_unsupported_video_types_are_refused(api, name, content, tmp_path):
    user = api.user()
    res = upload_video(api, user, playlist(api, user), name, content)
    assert res.status_code == 400 and res.json()["code"] == "unsupported_format"
    assert kept_files(tmp_path) == []


@pytest.mark.parametrize("name,content", [
    ("fake.mp4", samples.EXE), ("fake.mp4", samples.TXT), ("fake.mkv", samples.MP4), ("fake.avi", samples.WAV),
    ("fake.wav", samples.AVI), ("fake.mp3", samples.PNG), ("fake.webm", samples.HTML),
])
def test_files_that_are_not_really_video_are_refused(api, name, content, tmp_path):
    user = api.user()
    res = upload_video(api, user, playlist(api, user), name, content)
    assert res.status_code == 400 and res.json()["code"] == "content_mismatch"
    assert kept_files(tmp_path) == [] and api.sql("select count(*) from video_uploads")[0][0] == 0


def test_empty_oversized_and_foreign_playlist(api, tmp_path, monkeypatch):
    alice, bob = api.user(), api.user()
    pid = playlist(api, alice)
    assert upload_video(api, alice, pid, content=b"").json()["code"] == "empty_file"
    assert upload_video(api, bob, pid).status_code == 404          # not Bob's playlist
    assert upload_video(api, alice, "not-a-uuid").status_code == 404
    set_env(monkeypatch, MAX_UPLOAD_MB="0")
    assert upload_video(api, alice, pid).status_code == 413
    assert kept_files(tmp_path) == [] and not list((tmp_path / "data" / "tmp").glob("*"))


def test_playlist_size_and_storage_limits(api, tmp_path, monkeypatch):
    user = api.user()
    monkeypatch.setattr(playlist_repo, "MAX_ITEMS", 1)
    pid = playlist(api, user)
    assert upload_video(api, user, pid, "a.mp4").status_code == 201
    assert upload_video(api, user, pid, "b.mp4", samples.MP4 + b"b").json()["code"] == "playlist_full"
    assert len(kept_files(tmp_path)) == 1
    monkeypatch.setattr(playlist_repo, "MAX_ITEMS", 50)
    set_env(monkeypatch, USER_STORAGE_QUOTA_MB="1")
    big = samples.MP4 + b"\0" * 1_100_000
    assert upload_video(api, user, pid, "big.mp4", big).json()["code"] == "storage_full"


def test_a_failure_while_saving_leaves_no_stray_file(api, tmp_path, monkeypatch):
    user = api.user()
    pid = playlist(api, user)

    def boom(*args, **kwargs):
        raise RuntimeError("database trouble")

    monkeypatch.setattr(playlist_repo, "add_items", boom)
    with pytest.raises(RuntimeError):  # (the test client re-raises; a real server answers with an error page)
        upload_video(api, user, pid)
    assert kept_files(tmp_path) == [] and api.sql("select count(*) from video_uploads")[0][0] == 0


def test_uploaded_videos_count_against_the_same_storage_as_documents(api, monkeypatch):
    set_env(monkeypatch, USER_STORAGE_QUOTA_MB="1")
    user = api.user()
    pid = playlist(api, user)
    assert api.client.post("/api/documents", headers=user.headers,
                           files={"file": ("a.txt", io.BytesIO(b"a" * 700_000), "text/plain")}).status_code == 201
    assert upload_video(api, user, pid, "v.mp4", samples.MP4 + b"\0" * 500_000).json()["code"] == "storage_full"
    assert api.client.get("/api/me/storage", headers=user.headers).json()["used_bytes"] == 700_000


# ------------------------------------------------------------------ playback

def stream_url(api, user, upload_id):
    return api.client.get(f"/api/uploads/{upload_id}/stream-url", headers=user.headers)


def test_playing_the_uploaded_video_with_a_temporary_link(api):
    user = api.user()
    item = upload_video(api, user, playlist(api, user), content=samples.MP4).json()
    link = stream_url(api, user, item["upload_id"]).json()
    assert link["mime"] == "video/mp4" and link["expires_in"] == 600
    res = api.client.get(link["url"])  # no login header: the temporary token is the proof
    assert res.status_code == 200 and res.content == samples.MP4
    assert res.headers["content-type"] == "video/mp4" and res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["cache-control"] == "private, no-store"


def test_seeking_works_with_range_requests(api):
    user = api.user()
    content = samples.MP4 + bytes(range(256)) * 8
    item = upload_video(api, user, playlist(api, user), content=content).json()
    url = stream_url(api, user, item["upload_id"]).json()["url"]
    res = api.client.get(url, headers={"Range": "bytes=100-199"})
    assert res.status_code == 206 and res.content == content[100:200]
    assert res.headers["content-range"] == f"bytes 100-199/{len(content)}"
    tail = api.client.get(url, headers={"Range": "bytes=-50"})
    assert tail.status_code == 206 and tail.content == content[-50:]


def test_the_stream_needs_a_valid_token_for_this_video_only(api):
    user = api.user()
    pid = playlist(api, user)
    a = upload_video(api, user, pid, "a.mp4", samples.MP4 + b"a").json()["upload_id"]
    b = upload_video(api, user, pid, "b.mp4", samples.MP4 + b"b").json()["upload_id"]
    base = f"/api/uploads/{a}/stream"
    good = signing.sign("upload-stream", a)
    assert api.client.get(base).status_code == 403
    assert api.client.get(base + "?token=junk").status_code == 403
    assert api.client.get(f"{base}?token={good}").status_code == 200
    assert api.client.get(f"{base}?token={good[:-2]}zz").status_code == 403
    assert api.client.get(f"{base}?token={signing.sign('upload-stream', a, ttl_seconds=-1)}").status_code == 403
    assert api.client.get(f"/api/uploads/{b}/stream?token={good}").status_code == 403          # another video
    assert api.client.get(f"{base}?token={signing.sign('document-download', a)}").status_code == 403  # another purpose
    assert api.client.get("/api/uploads/not-a-uuid/stream?token=x").status_code == 403


def test_other_users_cannot_get_a_stream_link_or_touch_the_upload(api):
    alice, bob = api.user(), api.user()
    upload_id = upload_video(api, alice, playlist(api, alice)).json()["upload_id"]
    assert stream_url(api, bob, upload_id).status_code == 404
    assert api.client.post(f"/api/uploads/{upload_id}/summarize", headers=bob.headers).status_code == 404
    assert api.client.delete(f"/api/uploads/{upload_id}", headers=bob.headers).status_code == 404
    assert stream_url(api, alice, "not-a-uuid").status_code == 404
    assert api.sql("select count(*) from video_uploads")[0][0] == 1


# ------------------------------------------------------------------ summarize

def test_summarize_hands_the_video_to_the_pipeline_and_keeps_the_original(api, tmp_path):
    user = api.user()
    pid = playlist(api, user)
    item = upload_video(api, user, pid, "Gradient Descent.mp4").json()
    res = api.client.post(f"/api/uploads/{item['upload_id']}/summarize", headers=user.headers, json={})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "queued" and body["video_id"] and body["job_id"]
    assert api.client.get("/api/me/usage", headers=user.headers).json()["used"] == 1
    assert items(api, user, pid)[0]["status"] == "pending"     # the item now follows the video's progress

    assert worker.run_once(make_deps(tmp_path), "w")
    job = api.client.get(f"/api/job/{body['job_id']}", headers=user.headers).json()
    assert job["status"] == "completed"
    done = items(api, user, pid)[0]
    assert done["status"] == "ready" and done["video_id"] == body["video_id"] and done["title"] == "Gradient Descent.mp4"
    assert len(kept_files(tmp_path)) == 1                      # the worker removed only its own copy
    assert api.client.get(stream_url(api, user, item["upload_id"]).json()["url"]).status_code == 200  # still playable


def test_the_video_page_can_find_the_upload_to_play(api, tmp_path):
    user = api.user()
    item = upload_video(api, user, playlist(api, user)).json()
    video = api.client.post(f"/api/uploads/{item['upload_id']}/summarize", headers=user.headers, json={}).json()["video_id"]
    worker.run_once(make_deps(tmp_path), "w")
    detail = api.client.get(f"/api/videos/{video}", headers=user.headers).json()
    assert detail["upload_id"] == item["upload_id"] and detail["source"] == "upload" and detail["youtube_id"] is None


def test_summarizing_twice_is_refused_while_running_and_after_success(api, tmp_path):
    user = api.user()
    item = upload_video(api, user, playlist(api, user)).json()
    url = f"/api/uploads/{item['upload_id']}/summarize"
    assert api.client.post(url, headers=user.headers, json={}).status_code == 200
    assert api.client.post(url, headers=user.headers, json={}).json()["code"] == "already_processing"
    worker.run_once(make_deps(tmp_path), "w")
    assert api.client.post(url, headers=user.headers, json={}).json()["code"] == "already_summarized"
    assert api.client.get("/api/me/usage", headers=user.headers).json()["used"] == 1


def test_a_failed_summary_can_be_tried_again(api, tmp_path):
    user = api.user()
    pid = playlist(api, user)
    item = upload_video(api, user, pid).json()
    url = f"/api/uploads/{item['upload_id']}/summarize"
    first = api.client.post(url, headers=user.headers, json={}).json()

    worker.run_once(make_deps(tmp_path, transcribe_file=lambda p, j: ""), "w")
    assert api.client.get(f"/api/job/{first['job_id']}", headers=user.headers).json()["status"] == "failed"
    assert items(api, user, pid)[0]["status"] == "failed"
    second = api.client.post(url, headers=user.headers, json={})
    assert second.status_code == 200 and second.json()["job_id"] != first["job_id"]


def test_the_daily_limit_applies_when_summarizing(api, tmp_path):
    user = api.user()
    api.sql("update profiles set daily_video_limit = 1 where user_id = %s", (user.id,))
    pid = playlist(api, user)
    a = upload_video(api, user, pid, "a.mp4", samples.MP4 + b"a").json()["upload_id"]
    b = upload_video(api, user, pid, "b.mp4", samples.MP4 + b"b").json()["upload_id"]
    assert api.client.post(f"/api/uploads/{a}/summarize", headers=user.headers, json={}).status_code == 200
    res = api.client.post(f"/api/uploads/{b}/summarize", headers=user.headers, json={})
    assert res.status_code == 429 and res.json()["code"] == "daily_limit_reached"
    assert api.sql("select video_id is null from video_uploads where id = %s", (b,))[0][0] is True


def test_summarizing_a_file_someone_already_processed_uses_the_shared_cache(api, tmp_path):
    alice, bob = api.user(), api.user()
    same = samples.MP4 + b"identical"
    a = upload_video(api, alice, playlist(api, alice), content=same).json()["upload_id"]
    api.client.post(f"/api/uploads/{a}/summarize", headers=alice.headers, json={})
    deps = make_deps(tmp_path)
    worker.run_once(deps, "w")
    b = upload_video(api, bob, playlist(api, bob), content=same).json()["upload_id"]
    res = api.client.post(f"/api/uploads/{b}/summarize", headers=bob.headers, json={}).json()
    assert res["status"] == "completed"           # instant: served from the cache
    assert worker.run_once(deps, "w") is False


def test_a_missing_file_gives_a_clear_error_and_no_job(api, tmp_path):
    user = api.user()
    item = upload_video(api, user, playlist(api, user)).json()
    for path in kept_files(tmp_path):
        path.unlink()
    res = api.client.post(f"/api/uploads/{item['upload_id']}/summarize", headers=user.headers, json={})
    assert res.status_code == 404 and res.json()["code"] == "file_missing"
    assert api.sql("select count(*) from jobs")[0][0] == 0


# ------------------------------------------------------------------- cleanup

def test_removing_the_playlist_item_deletes_the_uploaded_file(api, tmp_path):
    user = api.user()
    pid = playlist(api, user)
    item = upload_video(api, user, pid).json()
    assert api.client.delete(f"/api/playlists/{pid}/items/{item['id']}", headers=user.headers).status_code == 204
    assert kept_files(tmp_path) == [] and api.sql("select count(*) from video_uploads")[0][0] == 0
    assert api.client.get("/api/me/storage", headers=user.headers).json()["used_bytes"] == 0


def test_deleting_the_upload_directly_removes_its_item_and_file(api, tmp_path):
    user = api.user()
    pid = playlist(api, user)
    item = upload_video(api, user, pid).json()
    assert api.client.delete(f"/api/uploads/{item['upload_id']}", headers=user.headers).status_code == 204
    assert items(api, user, pid) == [] and kept_files(tmp_path) == []
    assert api.client.delete(f"/api/uploads/{item['upload_id']}", headers=user.headers).status_code == 404


def test_deleting_a_whole_playlist_deletes_its_uploads(api, tmp_path):
    user = api.user()
    pid = playlist(api, user)
    upload_video(api, user, pid, "a.mp4", samples.MP4 + b"a")
    upload_video(api, user, pid, "b.mp4", samples.MP4 + b"b")
    api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert len(kept_files(tmp_path)) == 2
    assert api.client.delete(f"/api/playlists/{pid}", headers=user.headers).status_code == 204
    assert kept_files(tmp_path) == [] and api.sql("select count(*) from video_uploads")[0][0] == 0
    assert api.client.get("/api/me/storage", headers=user.headers).json()["used_bytes"] == 0


def test_deleting_a_playlist_does_not_touch_other_playlists_uploads(api, tmp_path):
    user = api.user()
    keep, drop = playlist(api, user, "keep"), playlist(api, user, "drop")
    upload_video(api, user, keep, "a.mp4", samples.MP4 + b"a")
    upload_video(api, user, drop, "b.mp4", samples.MP4 + b"b")
    api.client.delete(f"/api/playlists/{drop}", headers=user.headers)
    assert len(kept_files(tmp_path)) == 1 and len(items(api, user, keep)) == 1


def test_all_upload_endpoints_need_a_session(api):
    pid, uid = uuid.uuid4(), uuid.uuid4()
    for method, path in [("post", f"/api/playlists/{pid}/uploads"), ("get", f"/api/uploads/{uid}/stream-url"),
                         ("post", f"/api/uploads/{uid}/summarize"), ("delete", f"/api/uploads/{uid}")]:
        assert getattr(api.client, method)(path).status_code == 401, path
