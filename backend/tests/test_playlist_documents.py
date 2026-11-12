"""Documents beside videos: attached to a lesson, as rows of their own, shown inline."""
import io

import pytest

import samples
from apiutil import ready_video, youtube_url
from summarizer.features.playlists import sources


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr(sources, "fetch_video_title", lambda youtube_id, client=None: f"Title of {youtube_id}")


def yt(n):
    return youtube_url(n).split("v=")[1]


def make_playlist(api, user, title="Course"):
    return api.client.post("/api/playlists", headers=user.headers, json={"title": title}).json()["id"]


def add_youtube(api, user, playlist, n=1):
    assert api.client.post(f"/api/playlists/{playlist}/items", headers=user.headers, json={"url": youtube_url(n)}).status_code == 201


def items(api, user, playlist):
    return api.client.get(f"/api/playlists/{playlist}", headers=user.headers).json()["items"]


def attach(api, user, name, content, item_id, mime="application/octet-stream"):
    return api.client.post("/api/documents", headers=user.headers, data={"playlist_item_id": item_id},
                           files={"file": (name, io.BytesIO(content), mime)})


def loose(api, user, playlist, name, content):
    return api.client.post(f"/api/playlists/{playlist}/documents", headers=user.headers,
                           files={"file": (name, io.BytesIO(content), "application/octet-stream")})


def files_on_disk(tmp_path):
    root = tmp_path / "data" / "uploads" / "documents"
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


# ------------------------------------------------------------ attached to a lesson

def test_a_file_can_be_attached_to_a_video_that_is_not_summarized_yet(api):
    user = api.user()
    pl = make_playlist(api, user)
    add_youtube(api, user, pl)
    item = items(api, user, pl)[0]
    assert item["documents"] == []
    res = attach(api, user, "slides.pdf", samples.pdf("Lecture one slides"), item["id"])
    assert res.status_code == 201, res.text
    doc = res.json()
    assert doc["playlist_item_id"] == item["id"] and doc["video_id"] is None
    listed = items(api, user, pl)[0]["documents"]
    assert [d["filename"] for d in listed] == ["slides.pdf"] and listed[0]["has_text"] is True


def test_a_file_on_a_lesson_whose_video_is_known_is_also_attached_to_that_video(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path, 3)
    pl = make_playlist(api, user)
    api.client.post(f"/api/playlists/{pl}/items", headers=user.headers, json={"video_id": video})
    item = items(api, user, pl)[0]
    doc = attach(api, user, "notes.txt", samples.TXT, item["id"]).json()
    assert doc["video_id"] == video and doc["playlist_item_id"] == item["id"]
    in_workspace = api.client.get(f"/api/documents?video_id={video}", headers=user.headers).json()["items"]
    assert [d["id"] for d in in_workspace] == [doc["id"]]  # the video page shows it too


def test_files_added_in_the_video_page_also_show_beside_its_lesson(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path, 4)
    pl = make_playlist(api, user)
    api.client.post(f"/api/playlists/{pl}/items", headers=user.headers, json={"video_id": video})
    api.client.post("/api/documents", headers=user.headers, data={"video_id": video},
                    files={"file": ("from-workspace.txt", io.BytesIO(samples.TXT), "text/plain")})
    assert [d["filename"] for d in items(api, user, pl)[0]["documents"]] == ["from-workspace.txt"]


def test_the_same_file_cannot_be_added_twice_to_one_lesson_but_can_go_to_two(api):
    user = api.user()
    pl = make_playlist(api, user)
    add_youtube(api, user, pl, 1)
    add_youtube(api, user, pl, 2)
    first, second = items(api, user, pl)
    assert attach(api, user, "a.txt", samples.TXT, first["id"]).status_code == 201
    dup = attach(api, user, "a.txt", samples.TXT, first["id"])
    assert dup.status_code == 409 and dup.json()["code"] == "already_uploaded"
    assert attach(api, user, "a.txt", samples.TXT, second["id"]).status_code == 201


def test_only_your_own_lessons_and_never_a_file_row(api):
    alice, bob = api.user(), api.user()
    pl = make_playlist(api, alice)
    add_youtube(api, alice, pl)
    lesson = items(api, alice, pl)[0]
    assert attach(api, bob, "x.txt", samples.TXT, lesson["id"]).status_code == 404
    assert attach(api, alice, "x.txt", samples.TXT, "not-a-uuid").status_code == 404
    row = loose(api, alice, pl, "loose.txt", samples.TXT).json()
    row_item = [i for i in items(api, alice, pl) if i["kind"] == "document"][0]
    assert row["item_id"] == row_item["id"]
    res = attach(api, alice, "y.txt", b"other words", row_item["id"])
    assert res.status_code == 400 and res.json()["code"] == "not_a_lesson"


def test_attach_and_detach_an_existing_file_with_patch(api):
    user = api.user()
    pl = make_playlist(api, user)
    add_youtube(api, user, pl)
    lesson = items(api, user, pl)[0]
    standalone = api.client.post("/api/documents", headers=user.headers, files={"file": ("s.txt", io.BytesIO(samples.TXT), "text/plain")}).json()
    moved = api.client.patch(f"/api/documents/{standalone['id']}", headers=user.headers, json={"playlist_item_id": lesson["id"]}).json()
    assert moved["playlist_item_id"] == lesson["id"]
    assert [d["id"] for d in items(api, user, pl)[0]["documents"]] == [standalone["id"]]
    api.client.patch(f"/api/documents/{standalone['id']}", headers=user.headers, json={"playlist_item_id": None})
    assert items(api, user, pl)[0]["documents"] == []
    bob = api.user()
    assert api.client.patch(f"/api/documents/{standalone['id']}", headers=bob.headers, json={"playlist_item_id": lesson["id"]}).status_code == 404


# ------------------------------------------------------------ files as rows

def test_a_file_becomes_a_row_that_can_be_ordered_like_a_video(api):
    user = api.user()
    pl = make_playlist(api, user)
    add_youtube(api, user, pl, 1)
    add_youtube(api, user, pl, 2)
    res = loose(api, user, pl, "syllabus.pdf", samples.pdf("Syllabus words"))
    assert res.status_code == 201, res.text
    rows = items(api, user, pl)
    assert [r["kind"] for r in rows] == ["youtube", "youtube", "document"]
    doc_row = rows[2]
    assert doc_row["title"] == "syllabus.pdf" and doc_row["document"]["extension"] == "pdf" and doc_row["document"]["has_text"] is True
    assert doc_row["status"] is None and doc_row["documents"] == []
    # move the file row to the top
    moved = api.client.patch(f"/api/playlists/{pl}/items/{doc_row['id']}/move", headers=user.headers,
                             json={"after_id": None, "before_id": rows[0]["id"]})
    assert moved.status_code in (200, 204)
    assert items(api, user, pl)[0]["kind"] == "document"


def test_same_file_twice_in_one_playlist_is_refused_but_other_playlists_are_fine(api):
    user = api.user()
    one, two = make_playlist(api, user, "One"), make_playlist(api, user, "Two")
    assert loose(api, user, one, "a.txt", samples.TXT).status_code == 201
    dup = loose(api, user, one, "a-copy.txt", samples.TXT)
    assert dup.status_code == 409 and dup.json()["code"] == "already_uploaded"
    assert loose(api, user, two, "a.txt", samples.TXT).status_code == 201


def test_file_rows_are_validated_and_private(api):
    alice, bob = api.user(), api.user()
    pl = make_playlist(api, alice)
    assert loose(api, bob, pl, "a.txt", samples.TXT).status_code == 404
    assert loose(api, alice, pl, "virus.exe", samples.EXE).status_code == 400
    assert loose(api, alice, pl, "fake.pdf", samples.TXT).json()["code"] == "content_mismatch"
    assert loose(api, alice, "nope", "a.txt", samples.TXT).status_code == 404
    assert items(api, alice, pl) == []


def test_removing_a_file_row_deletes_the_file_and_frees_the_space(api, tmp_path):
    user = api.user()
    pl = make_playlist(api, user)
    loose(api, user, pl, "a.txt", samples.TXT)
    assert len(files_on_disk(tmp_path)) == 1
    item = items(api, user, pl)[0]
    assert api.client.delete(f"/api/playlists/{pl}/items/{item['id']}", headers=user.headers).status_code == 204
    assert files_on_disk(tmp_path) == []
    assert api.sql("select count(*) from documents")[0][0] == 0
    assert api.client.get("/api/me/storage", headers=user.headers).json()["used_bytes"] == 0


def test_removing_a_lesson_deletes_files_only_it_owned(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path, 5)
    pl = make_playlist(api, user)
    add_youtube(api, user, pl, 1)                                           # lesson without a video yet
    api.client.post(f"/api/playlists/{pl}/items", headers=user.headers, json={"video_id": video})  # lesson with a video
    first, second = items(api, user, pl)
    attach(api, user, "only-lesson.txt", samples.TXT, first["id"])
    attach(api, user, "also-video.txt", b"kept for the video", second["id"])
    assert len(files_on_disk(tmp_path)) == 2
    api.client.delete(f"/api/playlists/{pl}/items/{first['id']}", headers=user.headers)
    api.client.delete(f"/api/playlists/{pl}/items/{second['id']}", headers=user.headers)
    names = api.sql("select filename from documents")
    assert [n[0] for n in names] == ["also-video.txt"]       # still reachable from the video page
    assert len(files_on_disk(tmp_path)) == 1


def test_deleting_a_playlist_cleans_up_all_its_files(api, tmp_path):
    user = api.user()
    pl = make_playlist(api, user)
    add_youtube(api, user, pl)
    attach(api, user, "lesson.txt", samples.TXT, items(api, user, pl)[0]["id"])
    loose(api, user, pl, "row.txt", b"row words")
    assert len(files_on_disk(tmp_path)) == 2
    assert api.client.delete(f"/api/playlists/{pl}", headers=user.headers).status_code == 204
    assert files_on_disk(tmp_path) == []
    assert api.sql("select count(*) from documents")[0][0] == 0


def test_deleting_the_file_itself_removes_its_row(api):
    user = api.user()
    pl = make_playlist(api, user)
    doc = loose(api, user, pl, "a.txt", samples.TXT).json()
    assert api.client.delete(f"/api/documents/{doc['id']}", headers=user.headers).status_code == 204
    assert items(api, user, pl) == []


def test_playlist_counts_include_file_rows_and_do_not_break_listing(api):
    user = api.user()
    pl = make_playlist(api, user)
    loose(api, user, pl, "a.txt", samples.TXT)
    add_youtube(api, user, pl)
    listed = api.client.get("/api/playlists", headers=user.headers).json()["items"][0]
    assert listed["item_count"] == 2
    detail = api.client.get(f"/api/playlists/{pl}", headers=user.headers).json()
    assert detail["item_count"] == 2 and detail["completed_count"] == 0


# ------------------------------------------------------------ opening files

VIEWABLE = [("doc.pdf", lambda: samples.pdf("view me"), "application/pdf"), ("pic.png", lambda: samples.PNG, "image/png"),
            ("pic.jpg", lambda: samples.JPG, "image/jpeg"), ("pic.gif", lambda: samples.GIF, "image/gif"),
            ("pic.webp", lambda: samples.WEBP, "image/webp")]


@pytest.mark.parametrize("name,build,mime", VIEWABLE)
def test_pdf_and_pictures_open_inline_with_safe_headers(api, name, build, mime):
    user = api.user()
    pl = make_playlist(api, user)
    doc = loose(api, user, pl, name, build()).json()
    info = api.client.get(f"/api/documents/{doc['id']}/view-url", headers=user.headers).json()
    assert info["kind"] == ("pdf" if name.endswith("pdf") else "image")
    res = api.client.get(info["url"])
    assert res.status_code == 200 and res.headers["content-type"].startswith(mime)
    assert res.headers["content-disposition"].startswith("inline")
    assert res.headers["x-content-type-options"] == "nosniff" and "no-store" in res.headers["cache-control"]
    assert "frame-ancestors 'self'" in res.headers["content-security-policy"]
    if not name.endswith("pdf"):
        assert "default-src 'none'" in res.headers["content-security-policy"]


@pytest.mark.parametrize("name,build", [("a.docx", lambda: samples.docx("w")), ("a.pptx", lambda: samples.pptx("w")), ("a.xlsx", samples.xlsx),
                                         ("a.txt", lambda: samples.TXT), ("a.rtf", lambda: samples.RTF), ("a.odt", samples.odt)])
def test_other_formats_are_not_served_inline(api, name, build):
    user = api.user()
    pl = make_playlist(api, user)
    doc = loose(api, user, pl, name, build()).json()
    res = api.client.get(f"/api/documents/{doc['id']}/view-url", headers=user.headers)
    assert res.status_code == 415 and res.json()["code"] == "not_viewable"


def test_inline_links_need_a_valid_token_and_the_right_owner(api, monkeypatch):
    alice, bob = api.user(), api.user()
    pl = make_playlist(api, alice)
    doc = loose(api, alice, pl, "a.pdf", samples.pdf("secret")).json()
    assert api.client.get(f"/api/documents/{doc['id']}/view-url", headers=bob.headers).status_code == 404
    assert api.client.get(f"/api/documents/{doc['id']}/view").status_code == 403
    assert api.client.get(f"/api/documents/{doc['id']}/view?token=bad").status_code == 403
    # a download token is not a view token
    dl = api.client.get(f"/api/documents/{doc['id']}/download-url", headers=alice.headers).json()["url"]
    assert api.client.get(dl.replace("/file?", "/view?")).status_code == 403
    # and a view token cannot open a different document
    other = loose(api, alice, pl, "b.pdf", samples.pdf("other")).json()
    token = api.client.get(f"/api/documents/{doc['id']}/view-url", headers=alice.headers).json()["url"].split("token=")[1]
    assert api.client.get(f"/api/documents/{other['id']}/view?token={token}").status_code == 403


def test_downloads_still_always_download(api):
    user = api.user()
    pl = make_playlist(api, user)
    doc = loose(api, user, pl, "a.pdf", samples.pdf("x")).json()
    url = api.client.get(f"/api/documents/{doc['id']}/download-url", headers=user.headers).json()["url"]
    res = api.client.get(url)
    assert res.headers["content-disposition"].startswith("attachment")
