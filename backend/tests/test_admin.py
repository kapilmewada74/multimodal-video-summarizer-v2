"""The admin panel's API: who gets in, what each role can do, and that every change is recorded."""
import psycopg
import pytest

from apiutil import ready_video

CONTACT = {"email": "visitor@example.org", "name": "Vi", "category": "bug", "subject": "Broken",
           "message": "Something is broken, please look at it."}


def get(api, who, path, **kw):
    return api.client.get(f"/api/admin{path}", headers=who.headers, **kw)


def post(api, who, path, body=None):
    return api.client.post(f"/api/admin{path}", headers=who.headers, json=body or {})


def audit_actions(api):
    return [r[0] for r in api.sql("select action from admin_audit_log order by id")]


# ----------------------------------------------------------------- who gets in

def test_me_says_whether_the_caller_is_staff_without_failing_for_anyone(api):
    assert get(api, api.user(), "/me").json() == {"is_staff": False}
    sub = get(api, api.staff("sub_admin"), "/me").json()
    assert sub["is_staff"] and sub["role"] == "sub_admin" and "users.suspend" not in sub["permissions"]
    admin = get(api, api.staff("admin"), "/me").json()
    assert admin["role"] == "admin" and "staff.manage" in admin["permissions"]


def test_everything_else_is_a_plain_404_for_people_who_are_not_staff(api):
    person = api.user()
    for path in ("/overview", "/users", "/tickets", "/videos", "/staff", "/audit"):
        res = get(api, person, path)
        assert res.status_code == 404 and res.json()["code"] == "not_found", path


def test_signed_out_and_guest_callers_are_turned_away(api):
    assert api.client.get("/api/admin/overview").status_code == 401
    assert api.client.get("/api/admin/overview", headers=api.guest().headers).status_code == 403


def test_a_guest_token_cannot_be_staff_even_if_a_role_row_exists(api):
    guest = api.guest()
    api.sql("insert into staff_roles (user_id, role) values (%s, 'admin')", (guest.id,))
    assert get(api, guest, "/overview").status_code == 403


def test_taking_a_role_away_works_immediately(api):
    sub = api.staff("sub_admin")
    assert get(api, sub, "/overview").status_code == 200
    api.sql("delete from staff_roles where user_id = %s", (sub.id,))
    assert get(api, sub, "/overview").status_code == 404


def test_admin_responses_are_never_cached(api):
    assert get(api, api.staff(), "/overview").headers["cache-control"] == "no-store"


# --------------------------------------------------------------------- overview

def test_overview_counts_and_what_each_role_sees(api, tmp_path):
    admin, sub = api.staff("admin"), api.staff("sub_admin")
    person = api.user()
    api.guest()
    ready_video(api, person, tmp_path)
    api.client.post("/api/contact", json=CONTACT)
    body = get(api, admin, "/overview").json()
    assert body["users"]["guests"] == 1 and body["users"]["accounts"] == 3
    assert body["activity"]["videos_total"] == 1 and body["support"]["open"] == 1
    assert body["system"]["queue"] is not None and body["alerts"] == []
    seen_by_sub = get(api, sub, "/overview").json()
    assert seen_by_sub["system"] is None and seen_by_sub["alerts"] is None   # queue health is for admins


# ------------------------------------------------------------------------ users

def test_sub_admins_see_masked_emails_admins_see_full_ones(api):
    admin, sub = api.staff("admin"), api.staff("sub_admin")
    person = api.user()
    email = f"{person.id}@example.com"
    full = get(api, admin, "/users", params={"q": person.id}).json()["items"][0]["email"]
    masked = get(api, sub, "/users", params={"q": person.id}).json()["items"][0]["email"]
    assert full == email and masked == email[:2] + "***@example.com" and masked != email


def test_sub_admins_cannot_search_by_part_of_an_address(api):
    """Otherwise typing "a", "ab", ... would reveal the addresses they are not allowed to see."""
    admin, sub = api.staff("admin"), api.staff("sub_admin")
    person = api.user()
    email = f"{person.id}@example.com"
    part = email[:8]
    assert get(api, admin, "/users", params={"q": part}).json()["total"] >= 1
    assert get(api, sub, "/users", params={"q": part}).json()["total"] == 0
    assert get(api, sub, "/users", params={"q": email}).json()["total"] == 1       # the whole address is fine
    assert get(api, sub, "/users", params={"q": email.upper()}).json()["total"] == 1


def test_user_list_filters_and_paging(api):
    admin = api.staff()
    for _ in range(3):
        api.user()
    api.guest()
    assert get(api, admin, "/users", params={"kind": "guests"}).json()["total"] == 1
    assert get(api, admin, "/users", params={"kind": "accounts"}).json()["total"] == 4
    page = get(api, admin, "/users", params={"limit": 2, "offset": 2}).json()
    assert len(page["items"]) == 2 and page["total"] == 5
    assert get(api, admin, "/users", params={"limit": 1000}).status_code == 422
    assert get(api, admin, "/users", params={"kind": "x"}).status_code == 422


def test_like_characters_in_a_search_are_taken_literally(api):
    admin = api.staff()
    api.user()
    assert get(api, admin, "/users", params={"q": "%"}).json()["total"] == 0
    assert get(api, admin, "/users", params={"q": "_"}).json()["total"] == 0


def test_user_detail_shows_facts_not_study_content_and_is_audited(api, tmp_path):
    admin = api.staff()
    person = api.user()
    ready_video(api, person, tmp_path)
    detail = get(api, admin, f"/users/{person.id}").json()
    assert detail["videos"] == 1 and detail["usage"]["jobs_total"] == 1 and detail["recent_jobs"][0]["status"] == "completed"
    assert not {"summary", "transcript", "notes"} & set(detail)
    assert "user.view" in audit_actions(api)
    assert get(api, admin, "/users/not-a-uuid").status_code == 404


# ------------------------------------------------------------ suspend and limits

def test_suspending_blocks_the_person_and_unsuspending_restores_them(api):
    admin, person = api.staff(), api.user()
    assert api.client.get("/api/me/limits", headers=person.headers).status_code == 200
    assert post(api, admin, f"/users/{person.id}/suspend", {"reason": "abuse of the free tier"}).status_code == 200
    blocked = api.client.get("/api/me/limits", headers=person.headers)
    assert blocked.status_code == 403 and blocked.json()["code"] == "account_suspended"
    assert "abuse" not in blocked.text                                              # the reason stays internal
    assert post(api, admin, f"/users/{person.id}/unsuspend").status_code == 200
    assert api.client.get("/api/me/limits", headers=person.headers).status_code == 200
    assert audit_actions(api) == ["user.suspend", "user.unsuspend"]


def test_a_suspended_person_can_still_ask_for_help(api):
    admin, person = api.staff(), api.user()
    post(api, admin, f"/users/{person.id}/suspend", {"reason": "spam"})
    res = api.client.post("/api/contact", headers=person.headers, json=CONTACT)
    assert res.status_code == 201 and api.sql("select user_id from support_tickets")[0][0] is None


def test_a_suspension_needs_a_reason_and_an_admin(api):
    admin, sub, person = api.staff(), api.staff("sub_admin"), api.user()
    assert post(api, admin, f"/users/{person.id}/suspend", {"reason": ""}).status_code == 422
    assert post(api, sub, f"/users/{person.id}/suspend", {"reason": "because"}).status_code == 403
    assert api.sql("select suspended_at from profiles where user_id = %s", (person.id,))[0][0] is None


def test_staff_cannot_be_suspended_and_nobody_suspends_themselves(api):
    admin, other, sub = api.staff(), api.staff(), api.staff("sub_admin")
    assert post(api, admin, f"/users/{admin.id}/suspend", {"reason": "oops"}).json()["code"] == "own_account"
    assert post(api, admin, f"/users/{other.id}/suspend", {"reason": "oops"}).json()["code"] == "staff_account"
    assert post(api, admin, f"/users/{sub.id}/suspend", {"reason": "oops"}).status_code == 409
    assert post(api, admin, "/users/00000000-0000-0000-0000-000000000000/suspend", {"reason": "nobody"}).status_code == 404


def test_changing_a_daily_allowance(api):
    admin, sub, person = api.staff(), api.staff("sub_admin"), api.user()
    assert post(api, admin, f"/users/{person.id}/limit", {"daily_video_limit": 25}).json() == {"daily_video_limit": 25}
    assert api.client.get("/api/me/usage", headers=person.headers).json()["limit"] == 25
    assert post(api, admin, f"/users/{person.id}/limit", {"daily_video_limit": -1}).status_code == 422
    assert post(api, admin, f"/users/{person.id}/limit", {"daily_video_limit": 100000}).status_code == 422
    assert post(api, sub, f"/users/{person.id}/limit", {"daily_video_limit": 99}).status_code == 403
    entry = api.sql("select detail from admin_audit_log where action = 'user.limit'")[0][0]
    assert entry == {"from": 10, "to": 25}


# ---------------------------------------------------------------------- tickets

def make_ticket(api, **change):
    api.client.post("/api/contact", json={**CONTACT, **change})
    return api.sql("select id::text from support_tickets order by created_at desc limit 1")[0][0]


def test_tickets_are_listed_with_masked_addresses_for_sub_admins(api):
    sub, admin = api.staff("sub_admin"), api.staff()
    make_ticket(api)
    listing = get(api, sub, "/tickets").json()
    assert listing["total"] == 1 and listing["counts"]["open"] == 1
    assert listing["items"][0]["email"] == "vi***@example.org"
    assert get(api, admin, "/tickets").json()["items"][0]["email"] == "visitor@example.org"
    assert get(api, sub, "/tickets", params={"q": "visitor@"}).json()["total"] == 0     # not searchable by address
    assert get(api, admin, "/tickets", params={"q": "visitor@"}).json()["total"] == 1
    assert get(api, sub, "/tickets", params={"q": "broken"}).json()["total"] == 1


def test_working_a_ticket_from_open_to_resolved_leaves_a_trail(api):
    sub = api.staff("sub_admin")
    ticket = make_ticket(api)
    assert post(api, sub, f"/tickets/{ticket}", {"assign": "me", "status": "in_progress", "note": "Looking into it."}).status_code == 200
    detail = get(api, sub, f"/tickets/{ticket}").json()
    assert detail["status"] == "in_progress" and detail["assigned_to"] == sub.id
    assert [e["kind"] for e in detail["events"]] == ["status", "assign", "note"]
    assert get(api, sub, "/tickets", params={"mine": "true"}).json()["total"] == 1
    post(api, sub, f"/tickets/{ticket}", {"status": "resolved"})
    assert get(api, sub, "/tickets").json()["total"] == 0                                   # "active" hides it
    assert get(api, sub, "/tickets", params={"status": "resolved"}).json()["total"] == 1
    assert api.sql("select resolved_at is not null from support_tickets")[0][0] is True
    post(api, sub, f"/tickets/{ticket}", {"status": "open"})
    assert api.sql("select resolved_at from support_tickets")[0][0] is None
    assert {"ticket.status", "ticket.assign", "ticket.note"} <= set(audit_actions(api))


def test_a_ticket_update_must_change_something_and_use_known_values(api):
    sub = api.staff("sub_admin")
    ticket = make_ticket(api)
    assert post(api, sub, f"/tickets/{ticket}", {}).status_code == 422
    assert post(api, sub, f"/tickets/{ticket}", {"status": "deleted"}).status_code == 422
    assert post(api, sub, "/tickets/not-a-uuid", {"status": "open"}).status_code == 404


def test_replying_emails_the_person_and_is_recorded(api, monkeypatch):
    from conftest import set_env
    from summarizer.features.support import mail
    sub = api.staff("sub_admin")
    ticket = make_ticket(api)
    assert post(api, sub, f"/tickets/{ticket}/reply", {"message": "Thanks, fixed now."}).json()["code"] == "email_not_configured"
    set_env(monkeypatch, RESEND_API_KEY="k")
    sent = []
    monkeypatch.setattr(mail, "_send", lambda to, subject, text, markup, reply_to=None, client=None: sent.append((to, subject, text)) or True)
    res = post(api, sub, f"/tickets/{ticket}/reply", {"message": "Thanks, fixed now."})
    assert res.status_code == 200 and sent == [("visitor@example.org", "Re: Broken", "Thanks, fixed now.")]
    assert res.json()["status"] == "in_progress" and res.json()["events"][-1]["kind"] == "reply"
    monkeypatch.setattr(mail, "_send", lambda *a, **k: False)
    assert post(api, sub, f"/tickets/{ticket}/reply", {"message": "Second try please."}).json()["code"] == "email_failed"
    assert post(api, sub, f"/tickets/{ticket}/reply", {"message": "no"}).status_code == 422


# ----------------------------------------------------------------------- videos

@pytest.fixture()
def video_with_outputs(api, tmp_path, monkeypatch):
    from summarizer.features.outputs import service
    monkeypatch.setattr(service, "_generate", lambda kind, *a: {"flashcards": [{"front": "f", "back": "b", "tag": "t"}],
                                                                 "title": "T", "children": [], "slides": [], "provider": ""})
    owner = api.user()
    video = ready_video(api, owner, tmp_path)
    for kind in ("flashcards", "mindmap"):
        api.client.post(f"/api/videos/{video}/outputs/{kind}", headers=owner.headers)
    return owner, video


def test_staff_can_find_a_video_and_see_which_outputs_exist_but_not_its_text(api, video_with_outputs):
    _, video = video_with_outputs
    sub = api.staff("sub_admin")
    found = get(api, sub, "/videos", params={"q": "Test Video"}).json()
    assert found["total"] == 1 and found["items"][0]["outputs"] == ["flashcards", "mindmap"]
    detail = get(api, sub, f"/videos/{video}").json()
    assert [o["kind"] for o in detail["shared_outputs"]] == ["flashcards", "mindmap"]
    assert not {"summary", "transcript"} & set(detail)
    assert get(api, sub, "/videos", params={"q": "zzz-nothing"}).json()["total"] == 0


def test_removing_a_bad_shared_copy_makes_the_next_open_generate_a_new_one(api, video_with_outputs):
    owner, video = video_with_outputs
    sub = api.staff("sub_admin")
    res = post(api, sub, f"/videos/{video}/outputs/reset", {"kind": "flashcards", "reason": "wrong answers"})
    assert res.json() == {"removed": 1}
    assert [r[0] for r in api.sql("select kind from video_outputs")] == ["mindmap"]
    again = api.client.post(f"/api/videos/{video}/outputs/flashcards", headers=owner.headers)
    assert again.status_code == 200 and api.sql("select count(*) from video_outputs")[0][0] == 2
    assert audit_actions(api) == ["output.reset"]
    assert api.sql("select detail->>'reason' from admin_audit_log")[0][0] == "wrong answers"


def test_removing_a_shared_copy_keeps_peoples_own_copies(api, video_with_outputs, monkeypatch):
    owner, video = video_with_outputs
    monkeypatch.setattr("summarizer.features.outputs.service.REGENERATE_SAME_OUTPUT_SECONDS", 0)
    api.client.post(f"/api/videos/{video}/outputs/flashcards", headers=owner.headers, json={"force": True})
    post(api, api.staff(), f"/videos/{video}/outputs/reset", {"kind": "flashcards", "reason": "bad copy"})
    assert api.sql("select count(*) from user_outputs")[0][0] == 1


def test_resetting_needs_a_reason_a_real_video_and_the_right_role(api, video_with_outputs):
    _, video = video_with_outputs
    admin = api.staff()
    assert post(api, admin, f"/videos/{video}/outputs/reset", {"kind": "flashcards", "reason": ""}).status_code == 422
    assert post(api, admin, f"/videos/{video}/outputs/reset", {"kind": "bogus", "reason": "reason"}).status_code == 422
    assert post(api, admin, "/videos/00000000-0000-0000-0000-000000000000/outputs/reset",
                {"kind": "quiz", "reason": "reason"}).status_code == 404
    assert post(api, api.user(), f"/videos/{video}/outputs/reset", {"kind": "quiz", "reason": "reason"}).status_code == 404


# ------------------------------------------------------------------------ staff

def test_only_admins_manage_staff(api):
    admin, sub = api.staff(), api.staff("sub_admin")
    assert get(api, sub, "/staff").status_code == 403
    assert post(api, sub, "/staff", {"email": "x@example.org", "role": "sub_admin"}).status_code == 403
    listed = get(api, admin, "/staff").json()
    assert {s["role"] for s in listed["items"]} == {"admin", "sub_admin"} and listed["max_admins"] == 5


def test_granting_changing_and_removing_a_role(api):
    admin = api.staff()
    person = api.user()
    email = f"{person.id}@example.com"
    res = post(api, admin, "/staff", {"email": email.upper(), "role": "sub_admin"})
    assert res.status_code == 201 and any(s["id"] == person.id and s["role"] == "sub_admin" for s in res.json()["items"])
    assert get(api, person, "/overview").status_code == 200                       # works at once, no restart or deploy
    assert post(api, admin, "/staff", {"email": email, "role": "admin"}).json()["code"] == "already_staff"

    promoted = api.client.put(f"/api/admin/staff/{person.id}", headers=admin.headers, json={"role": "admin"})
    assert promoted.status_code == 200 and get(api, person, "/staff").status_code == 200
    removed = api.client.delete(f"/api/admin/staff/{person.id}", headers=admin.headers)
    assert removed.status_code == 200 and get(api, person, "/overview").status_code == 404
    assert audit_actions(api) == ["staff.grant", "staff.role", "staff.remove"]


def test_a_role_goes_only_to_a_real_signed_in_account(api):
    admin = api.staff()
    assert post(api, admin, "/staff", {"email": "nobody@example.org", "role": "sub_admin"}).json()["code"] == "user_not_found"
    guest = api.guest()
    api.sql("update auth.users set email = %s where id = %s", ("guest@example.org", guest.id))
    assert post(api, admin, "/staff", {"email": "guest@example.org", "role": "sub_admin"}).status_code == 404
    assert post(api, admin, "/staff", {"email": "x@example.org", "role": "owner"}).status_code == 422


def test_nobody_changes_their_own_role_and_the_last_admin_cannot_be_removed(api):
    admin, second = api.staff(), api.staff()
    own = api.client.delete(f"/api/admin/staff/{admin.id}", headers=admin.headers)
    assert own.json()["code"] == "own_account"
    assert api.client.put(f"/api/admin/staff/{admin.id}", headers=admin.headers, json={"role": "sub_admin"}).status_code == 409
    # Two admins: one removes the other, which is fine; the one left cannot then be touched by anyone.
    assert api.client.delete(f"/api/admin/staff/{second.id}", headers=admin.headers).status_code == 200
    only = api.client.delete(f"/api/admin/staff/{admin.id}", headers=admin.headers)
    assert only.status_code == 409


def test_two_admins_removing_each_other_at_the_same_moment_cannot_leave_nobody(api):
    """Each request passes the "are you an admin" check before either has finished. The count is therefore
    re-checked under a lock, so exactly one of them wins and one admin always remains."""
    import threading
    first, second = api.staff(), api.staff()
    barrier, codes = threading.Barrier(2), {}

    def remove(actor, target):
        barrier.wait()
        codes[actor.id] = api.client.delete(f"/api/admin/staff/{target.id}", headers=actor.headers).status_code

    threads = [threading.Thread(target=remove, args=(first, second)), threading.Thread(target=remove, args=(second, first))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(codes.values()) == [200, 409]
    assert api.sql("select count(*) from staff_roles where role = 'admin'")[0][0] == 1


def test_the_number_of_admins_is_capped(api, monkeypatch):
    monkeypatch.setenv("MAX_ADMINS", "2")
    admin = api.staff()
    first = api.user()
    assert post(api, admin, "/staff", {"email": f"{first.id}@example.com", "role": "admin"}).status_code == 201
    third = api.user()
    capped = post(api, admin, "/staff", {"email": f"{third.id}@example.com", "role": "admin"})
    assert capped.status_code == 409 and capped.json()["code"] == "too_many_admins"
    assert post(api, admin, "/staff", {"email": f"{third.id}@example.com", "role": "sub_admin"}).status_code == 201


def test_removing_staff_releases_their_tickets(api):
    admin, sub = api.staff(), api.staff("sub_admin")
    ticket = make_ticket(api)
    post(api, sub, f"/tickets/{ticket}", {"assign": "me"})
    api.client.delete(f"/api/admin/staff/{sub.id}", headers=admin.headers)
    assert api.sql("select assigned_to from support_tickets")[0][0] is None


# ------------------------------------------------------------------------ audit

def test_the_audit_log_is_readable_by_admins_only_and_filterable(api):
    admin, sub, person = api.staff(), api.staff("sub_admin"), api.user()
    post(api, admin, f"/users/{person.id}/suspend", {"reason": "spam"})
    post(api, admin, f"/users/{person.id}/unsuspend")
    assert get(api, sub, "/audit").status_code == 403
    everything = get(api, admin, "/audit").json()
    assert everything["total"] == 2 and everything["items"][0]["action"] == "user.unsuspend"   # newest first
    first = everything["items"][1]
    assert first["actor"] == f"{admin.id}@example.com" and first["role"] == "admin" and first["target_id"] == person.id
    assert first["detail"] == {"reason": "spam"}
    assert get(api, admin, "/audit", params={"action": "user.susp"}).json()["total"] == 1
    assert get(api, admin, "/audit", params={"target": person.id}).json()["total"] == 2
    assert get(api, admin, "/audit", params={"actor": "nobody"}).json()["total"] == 0


def test_the_audit_log_cannot_be_edited_or_emptied_even_with_database_access(api):
    admin, person = api.staff(), api.user()
    post(api, admin, f"/users/{person.id}/suspend", {"reason": "spam"})
    for statement in ("update admin_audit_log set action = 'x'", "delete from admin_audit_log", "truncate admin_audit_log"):
        with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
            api.sql(statement)
    assert api.sql("select count(*) from admin_audit_log")[0][0] == 1


def test_deleting_a_staff_account_does_not_break_or_change_the_log(api):
    admin, sub, person = api.staff(), api.staff("sub_admin"), api.user()
    post(api, sub, "/tickets/00000000-0000-0000-0000-000000000000", {"status": "open"})   # a failed call writes nothing
    post(api, admin, f"/users/{person.id}/suspend", {"reason": "spam"})
    api.client.request("DELETE", "/api/me", headers=admin.headers, json={"confirm": "DELETE"})
    row = api.sql("select actor_email, actor_role from admin_audit_log")[0]
    assert tuple(row) == (f"{admin.id}@example.com", "admin")


def test_a_burst_of_changes_is_rate_limited(api):
    admin, person = api.staff(), api.user()
    codes = [post(api, admin, f"/users/{person.id}/limit", {"daily_video_limit": 10 + i % 5}).status_code for i in range(65)]
    assert codes.count(200) == 60 and codes[-1] == 429
    assert get(api, admin, "/overview").status_code == 200     # reading is not limited
