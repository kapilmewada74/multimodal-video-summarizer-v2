"""Typed notes and playlists (including drag-and-drop reordering)."""
import uuid

import pytest

from apiutil import ready_video, youtube_url
from summarizer.features.playlists import repository as playlist_repo
from summarizer.features.playlists import sources
from summarizer.features.playlists.fractional import MAX_KEY_LENGTH


def yt(n):
    """An 11 character YouTube id."""
    return youtube_url(n).split("v=")[1]


@pytest.fixture(autouse=True)
def fake_youtube(monkeypatch):
    """No network: video titles and playlist contents are faked."""
    monkeypatch.setattr(sources, "fetch_video_title", lambda youtube_id, client=None: f"Title of {youtube_id}")
    state = {"entries": [{"id": yt(i), "title": f"Video {i}", "duration": 100 + i} for i in range(1, 6)], "fail": False}

    def fake_playlist(playlist_id):
        if state["fail"]:
            raise RuntimeError("network down")
        return {"title": "Imported course", "entries": list(state["entries"])}

    monkeypatch.setattr(sources, "fetch_playlist", fake_playlist)
    return state


# --------------------------------------------------------------------- notes

def test_notes_round_trip_and_overwrite(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert api.client.get(f"/api/videos/{video}/notes", headers=user.headers).json() == {"content": "", "updated_at": None}
    saved = api.client.put(f"/api/videos/{video}/notes", headers=user.headers, json={"content": "my **notes** हिन्दी 📝"})
    assert saved.status_code == 200 and saved.json()["length"] == len("my **notes** हिन्दी 📝")
    api.client.put(f"/api/videos/{video}/notes", headers=user.headers, json={"content": "second version"})
    got = api.client.get(f"/api/videos/{video}/notes", headers=user.headers).json()
    assert got["content"] == "second version" and got["updated_at"]
    assert api.sql("select count(*) from notes")[0][0] == 1


def test_notes_are_private_and_per_video(api, tmp_path):
    alice, bob = api.user(), api.user()
    first, second = ready_video(api, alice, tmp_path, 1), ready_video(api, alice, tmp_path, 2)
    api.submit(bob, 1)
    api.client.put(f"/api/videos/{first}/notes", headers=alice.headers, json={"content": "alice only"})
    assert api.client.get(f"/api/videos/{first}/notes", headers=bob.headers).json()["content"] == ""  # same video, own notes
    assert api.client.get(f"/api/videos/{second}/notes", headers=alice.headers).json()["content"] == ""
    carol = api.user()
    assert api.client.get(f"/api/videos/{first}/notes", headers=carol.headers).status_code == 404
    assert api.client.put(f"/api/videos/{first}/notes", headers=carol.headers, json={"content": "x"}).status_code == 404
    assert api.client.get("/api/videos/not-a-uuid/notes", headers=alice.headers).status_code == 404


def test_note_size_limit_and_validation(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert api.client.put(f"/api/videos/{video}/notes", headers=user.headers, json={"content": "x" * 200_000}).status_code == 200
    assert api.client.put(f"/api/videos/{video}/notes", headers=user.headers, json={"content": "x" * 200_001}).status_code == 422
    assert api.client.put(f"/api/videos/{video}/notes", headers=user.headers, json={}).status_code == 422
    assert api.client.put(f"/api/videos/{video}/notes", headers=user.headers, json={"content": ""}).status_code == 200


def test_notes_disappear_when_the_video_is_removed_from_the_library_only_for_access(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    api.client.put(f"/api/videos/{video}/notes", headers=user.headers, json={"content": "keep"})
    api.client.delete(f"/api/videos/{video}", headers=user.headers)
    assert api.client.get(f"/api/videos/{video}/notes", headers=user.headers).status_code == 404


# ----------------------------------------------------------------- playlists

def create(api, user, title="My course"):
    res = api.client.post("/api/playlists", headers=user.headers, json={"title": title})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def add_url(api, user, pid, n):
    return api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json={"url": youtube_url(n)})


def titles(api, user, pid):
    return [i["title"] for i in api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()["items"]]


def item_ids(api, user, pid):
    return [i["id"] for i in api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()["items"]]


def move(api, user, pid, item, after=None, before=None):
    return api.client.patch(f"/api/playlists/{pid}/items/{item}/move", headers=user.headers,
                            json={"after_id": after, "before_id": before})


def test_playlist_crud(api):
    user = api.user()
    pid = create(api, user, "  Physics   101  ")
    listing = api.client.get("/api/playlists", headers=user.headers).json()["items"]
    assert [(p["title"], p["item_count"]) for p in listing] == [("Physics 101", 0)]
    assert api.client.patch(f"/api/playlists/{pid}", headers=user.headers, json={"title": "Renamed"}).json()["title"] == "Renamed"
    assert api.client.delete(f"/api/playlists/{pid}", headers=user.headers).status_code == 204
    assert api.client.get(f"/api/playlists/{pid}", headers=user.headers).status_code == 404
    assert api.client.get("/api/playlists", headers=user.headers).json()["items"] == []


@pytest.mark.parametrize("title", ["", "   ", "x" * 121])
def test_playlist_title_validation(api, title):
    assert api.client.post("/api/playlists", headers=api.user().headers, json={"title": title}).status_code == 422


def test_playlists_are_private(api):
    alice, bob = api.user(), api.user()
    pid = create(api, alice)
    add_url(api, alice, pid, 1)
    assert api.client.get("/api/playlists", headers=bob.headers).json()["items"] == []
    for method, path, body in [("get", f"/api/playlists/{pid}", None), ("patch", f"/api/playlists/{pid}", {"title": "x"}),
                               ("delete", f"/api/playlists/{pid}", None),
                               ("post", f"/api/playlists/{pid}/items", {"url": youtube_url(2)})]:
        res = getattr(api.client, method)(path, headers=bob.headers, **({"json": body} if body else {}))
        assert res.status_code == 404, (method, path)
    assert api.client.get("/api/playlists/not-a-uuid", headers=alice.headers).status_code == 404


def test_playlist_limit(api, monkeypatch):
    monkeypatch.setattr(playlist_repo, "MAX_PLAYLISTS", 2)
    user = api.user()
    create(api, user)
    create(api, user)
    assert api.client.post("/api/playlists", headers=user.headers, json={"title": "third"}).status_code == 409


def test_adding_videos_by_link_keeps_order_and_looks_up_titles(api):
    user = api.user()
    pid = create(api, user)
    for n in (3, 1, 2):
        assert add_url(api, user, pid, n).status_code == 201
    assert titles(api, user, pid) == [f"Title of {yt(3)}", f"Title of {yt(1)}", f"Title of {yt(2)}"]
    item = api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()["items"][0]
    assert item["youtube_id"] == yt(3) and item["video_id"] is None and item["status"] is None and item["completed"] is False


def test_add_rejects_bad_input_and_duplicates(api, tmp_path):
    user = api.user()
    pid = create(api, user)
    assert add_url(api, user, pid, 1).status_code == 201
    assert add_url(api, user, pid, 1).status_code == 409
    for body in ({"url": "https://example.com/x"}, {"url": ""}, {}, {"url": youtube_url(2), "video_id": str(uuid.uuid4())}):
        assert api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json=body).status_code in (400, 422)
    assert api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json={"video_id": str(uuid.uuid4())}).status_code == 404
    assert api.sql("select count(*) from playlist_items")[0][0] == 1


def test_adding_a_library_video_uses_its_youtube_id_and_shows_progress(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)  # 120 seconds
    pid = create(api, user)
    assert api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json={"video_id": video}).status_code == 201
    api.client.put(f"/api/videos/{video}/progress", headers=user.headers, json={"position_seconds": 60})
    item = api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()["items"][0]
    assert item["video_id"] == video and item["status"] == "ready" and item["title"] == "Test Video"
    assert (item["progress_seconds"], item["percent"], item["completed"]) == (60, 50, False)
    api.client.put(f"/api/videos/{video}/progress", headers=user.headers, json={"position_seconds": 115})
    view = api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()
    assert view["items"][0]["completed"] is True and (view["item_count"], view["completed_count"]) == (1, 1)
    listing = api.client.get("/api/playlists", headers=user.headers).json()["items"][0]
    assert (listing["item_count"], listing["completed_count"]) == (1, 1)


def test_a_link_item_resolves_to_the_video_once_it_is_summarized_and_progress_is_private(api, tmp_path):
    alice, bob = api.user(), api.user()
    pid_a, pid_b = create(api, alice), create(api, bob)
    video = ready_video(api, alice, tmp_path, 1)
    youtube_id = api.sql("select youtube_id from videos")[0][0]
    for user, pid in ((alice, pid_a), (bob, pid_b)):
        api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json={"url": f"https://youtu.be/{youtube_id}"})
    a = api.client.get(f"/api/playlists/{pid_a}", headers=alice.headers).json()["items"][0]
    b = api.client.get(f"/api/playlists/{pid_b}", headers=bob.headers).json()["items"][0]
    assert a["video_id"] == video and a["status"] == "ready"
    assert b["video_id"] is None and b["status"] is None  # Bob has not added it to his library
    api.client.put(f"/api/videos/{video}/progress", headers=alice.headers, json={"position_seconds": 100})
    assert api.client.get(f"/api/playlists/{pid_b}", headers=bob.headers).json()["items"][0]["progress_seconds"] == 0


def test_uploaded_videos_can_be_added_by_library_id(api, tmp_path):
    from summarizer.features.jobs import worker
    from apiutil import make_deps

    user = api.user()
    job_id = api.upload(user, "Lecture.mp4", b"abcdef").json()["job_id"]
    worker.run_once(make_deps(tmp_path), "w")
    video = api.client.get(f"/api/job/{job_id}", headers=user.headers).json()["video_id"]
    pid = create(api, user)
    assert api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json={"video_id": video}).status_code == 201
    item = api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()["items"][0]
    assert item["youtube_id"] is None and item["video_id"] == video


def test_remove_item(api):
    user = api.user()
    pid = create(api, user)
    add_url(api, user, pid, 1)
    add_url(api, user, pid, 2)
    first = item_ids(api, user, pid)[0]
    assert api.client.delete(f"/api/playlists/{pid}/items/{first}", headers=user.headers).status_code == 204
    assert titles(api, user, pid) == [f"Title of {yt(2)}"]
    assert api.client.delete(f"/api/playlists/{pid}/items/{first}", headers=user.headers).status_code == 404
    assert api.client.delete(f"/api/playlists/{pid}/items/not-a-uuid", headers=user.headers).status_code == 404


def test_item_limit(api, monkeypatch):
    monkeypatch.setattr(playlist_repo, "MAX_ITEMS", 2)
    user = api.user()
    pid = create(api, user)
    add_url(api, user, pid, 1)
    add_url(api, user, pid, 2)
    assert add_url(api, user, pid, 3).status_code == 409


# ------------------------------------------------------------------ importing

def test_importing_a_youtube_playlist(api, fake_youtube):
    user = api.user()
    res = api.client.post("/api/playlists/import-youtube", headers=user.headers,
                          json={"url": "https://www.youtube.com/playlist?list=PLabcdefghij1234"})
    assert res.status_code == 201 and res.json()["title"] == "Imported course" and res.json()["item_count"] == 5
    pid = res.json()["id"]
    assert titles(api, user, pid) == [f"Video {i}" for i in range(1, 6)]
    first = api.client.get(f"/api/playlists/{pid}", headers=user.headers).json()["items"][0]
    assert first["duration"] == 101 and first["status"] is None
    assert api.sql("select source, source_id from playlists")[0] == ("youtube", "PLabcdefghij1234")
    # Importing does not summarize anything, so the daily video limit is untouched.
    assert api.client.get("/api/me/usage", headers=user.headers).json()["used"] == 0
    assert api.sql("select count(*) from jobs")[0][0] == 0


@pytest.mark.parametrize("url", ["https://example.com/playlist?list=PLabcdefghij1234", "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                                 "https://www.youtube.com/playlist?list=short", "", "javascript:alert(1)"])
def test_import_rejects_non_playlist_links(api, url):
    assert api.client.post("/api/playlists/import-youtube", headers=api.user().headers, json={"url": url}).status_code == 400


def test_import_accepts_a_video_link_inside_a_playlist():
    assert sources.extract_playlist_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij1234&index=2") == "PLabcdefghij1234"


def test_import_failures_are_reported_and_leave_nothing_behind(api, fake_youtube):
    user = api.user()
    fake_youtube["fail"] = True
    res = api.client.post("/api/playlists/import-youtube", headers=user.headers, json={"url": "https://www.youtube.com/playlist?list=PLabcdefghij1234"})
    assert res.status_code == 502 and "network" not in res.text
    fake_youtube["fail"], fake_youtube["entries"] = False, []
    assert api.client.post("/api/playlists/import-youtube", headers=user.headers, json={"url": "https://www.youtube.com/playlist?list=PLabcdefghij1234"}).status_code == 422
    assert api.sql("select count(*) from playlists")[0][0] == 0


# -------------------------------------------------------------------- reorder

def test_moving_items_in_every_position(api):
    user = api.user()
    pid = create(api, user)
    for n in (1, 2, 3, 4):
        add_url(api, user, pid, n)
    a, b, c, d = item_ids(api, user, pid)
    order = lambda: item_ids(api, user, pid)  # noqa: E731

    assert move(api, user, pid, d, after=None, before=a).status_code == 204  # to the front
    assert order() == [d, a, b, c]
    assert move(api, user, pid, d, after=c, before=None).status_code == 204  # to the end
    assert order() == [a, b, c, d]
    assert move(api, user, pid, a, after=b, before=c).status_code == 204  # into the middle
    assert order() == [b, a, c, d]


def test_a_move_changes_only_the_moved_row(api):
    user = api.user()
    pid = create(api, user)
    for n in (1, 2, 3, 4, 5):
        add_url(api, user, pid, n)
    ids = item_ids(api, user, pid)
    before = dict(api.sql("select id::text, position from playlist_items"))
    move(api, user, pid, ids[4], after=ids[0], before=ids[1])
    after = dict(api.sql("select id::text, position from playlist_items"))
    changed = [i for i in ids if before[i] != after[i]]
    assert changed == [ids[4]]


def test_the_order_survives_reloading_and_new_items_go_last(api):
    user = api.user()
    pid = create(api, user)
    for n in (1, 2, 3):
        add_url(api, user, pid, n)
    a, b, c = item_ids(api, user, pid)
    move(api, user, pid, c, after=None, before=a)
    add_url(api, user, pid, 4)
    assert item_ids(api, user, pid)[:3] == [c, a, b] and titles(api, user, pid)[-1] == f"Title of {yt(4)}"


def test_invalid_moves_are_refused(api):
    alice, bob = api.user(), api.user()
    pid, other = create(api, alice), create(api, alice, "other")
    for n in (1, 2, 3):
        add_url(api, alice, pid, n)
    add_url(api, alice, other, 9)
    a, b, c = item_ids(api, alice, pid)
    foreign = item_ids(api, alice, other)[0]
    assert move(api, alice, pid, a, after=a, before=b).status_code == 400       # next to itself
    assert move(api, alice, pid, a, after=foreign).status_code == 400            # neighbour from another playlist
    assert move(api, alice, pid, str(uuid.uuid4()), after=b).status_code == 400  # unknown item
    assert move(api, alice, pid, a, after="nope").status_code == 400
    assert move(api, bob, pid, a, after=b).status_code == 404
    assert item_ids(api, alice, pid) == [a, b, c]


def test_neighbours_in_the_wrong_order_are_a_clean_error_not_a_crash(api):
    user = api.user()
    pid = create(api, user)
    for n in (1, 2, 3, 4):
        add_url(api, user, pid, n)
    a, b, c, d = item_ids(api, user, pid)
    res = move(api, user, pid, a, after=d, before=b)  # "after d" but "before b" cannot both be true
    assert res.status_code == 400 and res.json()["code"] == "invalid_move"
    assert item_ids(api, user, pid) == [a, b, c, d]  # the order is unchanged


def test_crowded_keys_are_renumbered_automatically(api):
    user = api.user()
    pid = create(api, user)
    for n in (1, 2, 3):
        add_url(api, user, pid, n)
    a, b, c = item_ids(api, user, pid)
    # Keep dropping an item right after `a`: keys grow until the list is renumbered.
    for i in range(400):
        mover, other = (c, b) if i % 2 == 0 else (b, c)
        assert move(api, user, pid, mover, after=a, before=other).status_code == 204
    longest = max(len(p[0]) for p in api.sql("select position from playlist_items"))
    assert longest <= MAX_KEY_LENGTH + 2
    assert item_ids(api, user, pid)[0] == a and len(set(item_ids(api, user, pid))) == 3


def test_deleting_a_playlist_removes_its_items(api):
    user = api.user()
    pid = create(api, user)
    add_url(api, user, pid, 1)
    api.client.delete(f"/api/playlists/{pid}", headers=user.headers)
    assert api.sql("select count(*) from playlist_items")[0][0] == 0


def test_parallel_adds_all_succeed_with_distinct_positions(api):
    import threading

    user = api.user()
    pid = create(api, user)
    results = []

    def add(n):
        res = api.client.post(f"/api/playlists/{pid}/items", headers=user.headers, json={"url": youtube_url(n)})
        results.append(res.status_code)

    threads = [threading.Thread(target=add, args=(n,)) for n in range(1, 9)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(201) == 8
    positions = [p[0] for p in api.sql("select position from playlist_items")]
    assert len(set(positions)) == 8


def test_playlist_title_lookup_handles_failures(monkeypatch):
    import httpx

    class Boom:
        def get(self, *a, **k):
            raise httpx.ConnectError("down")

    monkeypatch.undo()  # use the real function, not the fake
    assert sources.fetch_video_title("dQw4w9WgXcQ", Boom()) is None

    class Ok:
        def get(self, url, params=None, timeout=None):
            assert params["url"].endswith("dQw4w9WgXcQ")
            return httpx.Response(200, json={"title": "Real title"}, request=httpx.Request("GET", url))

    assert sources.fetch_video_title("dQw4w9WgXcQ", Ok()) == "Real title"
