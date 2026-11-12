"""Editable summary and slides: per-user copies with version history."""
import uuid

from apiutil import ready_video

SLIDE = {"title": "Intro", "kicker": "01", "summary": "Hello", "bullets": ["a", "b"], "layout": "split_left_image",
         "image_asset": "", "notes": "say hi"}


def url(video, kind="summary", tail=""):
    return f"/api/videos/{video}/edits/{kind}{tail}"


def put(api, user, video, content, kind="summary", **extra):
    return api.client.put(url(video, kind), headers=user.headers, json={"content": content, **extra})


def test_empty_then_save_and_read_back(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert api.client.get(url(video), headers=user.headers).json() == {"content": None, "updated_at": None, "versions": []}
    saved = put(api, user, video, {"markdown": "# Mine हिन्दी"})
    assert saved.status_code == 200 and saved.json()["changed"] is True
    got = api.client.get(url(video), headers=user.headers).json()
    assert got["content"] == {"markdown": "# Mine हिन्दी"} and got["updated_at"] == saved.json()["updated_at"]
    assert got["versions"] == []  # nothing earlier to keep


def test_each_change_keeps_the_previous_version_and_identical_saves_do_not(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    put(api, user, video, {"markdown": "one"})
    assert put(api, user, video, {"markdown": "one"}).json()["changed"] is False
    put(api, user, video, {"markdown": "two"})
    put(api, user, video, {"markdown": "three"})
    versions = api.client.get(url(video), headers=user.headers).json()["versions"]
    assert len(versions) == 2
    contents = [api.client.get(url(video, tail=f"/versions/{v['id']}"), headers=user.headers).json()["content"]["markdown"]
                for v in versions]
    assert contents == ["two", "one"]  # newest first


def test_history_is_capped(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    for i in range(30):
        put(api, user, video, {"markdown": f"v{i}"})
    versions = api.client.get(url(video), headers=user.headers).json()["versions"]
    assert len(versions) == 20
    assert api.sql("select count(*) from user_edit_versions")[0][0] == 20


def test_restore_keeps_what_was_current(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    put(api, user, video, {"markdown": "old"})
    put(api, user, video, {"markdown": "new"})
    old = api.client.get(url(video), headers=user.headers).json()["versions"][0]["id"]
    restored = api.client.post(url(video, tail=f"/versions/{old}/restore"), headers=user.headers).json()
    assert restored["content"] == {"markdown": "old"}
    after = api.client.get(url(video), headers=user.headers).json()
    assert after["content"] == {"markdown": "old"}
    bodies = [api.client.get(url(video, tail=f"/versions/{v['id']}"), headers=user.headers).json()["content"]["markdown"]
              for v in after["versions"]]
    assert "new" in bodies  # the replaced text is still recoverable


def test_reset_to_ai_version_is_undoable(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    put(api, user, video, {"markdown": "mine"})
    assert api.client.delete(url(video), headers=user.headers).status_code == 204
    after = api.client.get(url(video), headers=user.headers).json()
    assert after["content"] is None and len(after["versions"]) == 1
    api.client.post(url(video, tail=f"/versions/{after['versions'][0]['id']}/restore"), headers=user.headers)
    assert api.client.get(url(video), headers=user.headers).json()["content"] == {"markdown": "mine"}
    assert api.client.delete(url(video, "slides"), headers=user.headers).status_code == 204  # nothing to reset is fine


def test_edits_are_private_to_the_user_even_on_a_shared_video(api, tmp_path):
    alice, bob, carol = api.user(), api.user(), api.user()
    video = ready_video(api, alice, tmp_path, 1)
    api.submit(bob, 1)
    put(api, alice, video, {"markdown": "alice edit"})
    assert api.client.get(url(video), headers=bob.headers).json()["content"] is None
    assert api.client.get(url(video), headers=carol.headers).status_code == 404
    assert put(api, carol, video, {"markdown": "x"}).status_code == 404
    assert api.client.delete(url(video), headers=carol.headers).status_code == 404
    version_user = api.user()
    put(api, alice, video, {"markdown": "second"})
    vid = api.client.get(url(video), headers=alice.headers).json()["versions"][0]["id"]
    assert api.client.get(url(video, tail=f"/versions/{vid}"), headers=bob.headers).status_code == 404
    assert api.client.post(url(video, tail=f"/versions/{vid}/restore"), headers=bob.headers).status_code == 404
    assert api.client.get(url(video, tail="/versions/not-a-uuid"), headers=alice.headers).status_code == 404
    assert api.client.get(url(video, tail=f"/versions/{uuid.uuid4()}"), headers=alice.headers).status_code == 404
    assert version_user.id


def test_conflicting_save_from_another_tab_is_refused(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    first = put(api, user, video, {"markdown": "a"}).json()["updated_at"]
    put(api, user, video, {"markdown": "b"}, base_updated_at=first)  # matches, fine
    stale = put(api, user, video, {"markdown": "c"}, base_updated_at=first)
    assert stale.status_code == 409 and stale.json()["code"] == "edit_conflict"
    assert api.client.get(url(video), headers=user.headers).json()["content"] == {"markdown": "b"}


def test_summary_validation(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert put(api, user, video, {"markdown": 5}).status_code == 422
    assert put(api, user, video, {}).status_code == 422
    assert put(api, user, video, {"markdown": "x" * 200_001}).status_code == 413
    assert api.client.put(url(video), headers=user.headers, json={"content": "text"}).status_code == 422
    assert api.client.get(url(video, "mindmap"), headers=user.headers).status_code == 422  # unknown kind


def test_slides_are_cleaned_and_bounded(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    messy = {"title": " Deck ", "slides": [{**SLIDE, "title": "  T  ", "bullets": ["ok", "", "  ", "x" * 500] + ["b"] * 20,
                                             "evil": "<script>"}], "extra": 1}
    assert put(api, user, video, messy, "slides").status_code == 200
    saved = api.client.get(url(video, "slides"), headers=user.headers).json()["content"]
    slide = saved["slides"][0]
    assert saved["title"] == "Deck" and slide["title"] == "T" and "evil" not in slide and "extra" not in saved
    assert len(slide["bullets"]) <= 12 and all(0 < len(b) <= 400 for b in slide["bullets"])
    assert put(api, user, video, {"slides": []}, "slides").status_code == 422
    assert put(api, user, video, {"slides": [SLIDE] * 41}, "slides").status_code == 422
    assert put(api, user, video, {"slides": [{**SLIDE, "title": " "}]}, "slides").status_code == 422
    assert put(api, user, video, {"slides": ["text"]}, "slides").status_code == 422


def test_markdown_export_uses_the_users_edited_summary(api, tmp_path):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path, 1)
    api.submit(bob, 1)
    put(api, alice, video, {"markdown": "## My own wording"})
    mine = api.client.get(f"/api/videos/{video}/export.md", headers=alice.headers).text
    theirs = api.client.get(f"/api/videos/{video}/export.md", headers=bob.headers).text
    assert "My own wording" in mine and "My own wording" not in theirs


def test_edits_are_removed_with_the_user_and_the_video(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    put(api, user, video, {"markdown": "a"})
    put(api, user, video, {"markdown": "b"})
    api.sql("delete from auth.users where id = %s", (user.id,))
    assert api.sql("select count(*) from user_edits")[0][0] == 0
    assert api.sql("select count(*) from user_edit_versions")[0][0] == 0
