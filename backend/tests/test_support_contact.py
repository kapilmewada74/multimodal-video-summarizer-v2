"""The Contact us form: anyone can write to us, spam is held back, nothing is emailed back automatically."""
import pytest

from conftest import set_env

GOOD = {"email": "ada@example.org", "name": "Ada", "category": "bug", "subject": "Upload fails",
        "message": "My upload stops at 90 percent, please help."}


def send(api, body=None, headers=None):
    return api.client.post("/api/contact", json=body or GOOD, headers=headers or {})


def test_a_visitor_without_an_account_can_write_to_us(api):
    res = send(api)
    assert res.status_code == 201 and res.json() == {"received": True}
    row = api.sql("select email, name, category, subject, status, user_id from support_tickets")[0]
    assert tuple(row) == ("ada@example.org", "Ada", "bug", "Upload fails", "open", None)


def test_a_signed_in_person_is_linked_to_their_account_and_sees_their_messages(api):
    me = api.user()
    send(api, headers=me.headers)
    assert api.sql("select user_id::text from support_tickets")[0][0] == me.id
    mine = api.client.get("/api/me/messages", headers=me.headers).json()["items"]
    assert [m["subject"] for m in mine] == ["Upload fails"] and mine[0]["status"] == "open"
    assert api.client.get("/api/me/messages", headers=api.user().headers).json()["items"] == []


def test_a_bad_token_is_just_a_visitor(api):
    assert send(api, headers={"Authorization": "Bearer nonsense"}).status_code == 201
    assert api.sql("select user_id from support_tickets")[0][0] is None


def test_the_subject_defaults_to_the_start_of_the_message(api):
    send(api, {**GOOD, "subject": ""})
    assert api.sql("select subject from support_tickets")[0][0].startswith("My upload stops")


@pytest.mark.parametrize("change,code", [
    ({"email": "not-an-email"}, "invalid_email"),
    ({"email": "a b@example.org"}, "invalid_email"),
    ({"message": "too short"}, "message_too_short"),
    ({"message": "see http://a.example http://b.example http://c.example http://d.example for details"}, "too_many_links"),
])
def test_bad_input_is_refused_with_a_readable_message(api, change, code):
    res = send(api, {**GOOD, **change})
    assert res.status_code == 422 and res.json()["code"] == code
    assert api.sql("select count(*) from support_tickets")[0][0] == 0


def test_oversized_fields_are_refused(api):
    assert send(api, {**GOOD, "message": "x" * 4001}).status_code == 422
    assert send(api, {**GOOD, "subject": "x" * 151}).status_code == 422


def test_an_unknown_category_becomes_general(api):
    send(api, {**GOOD, "category": "<script>"})
    assert api.sql("select category from support_tickets")[0][0] == "general"


def test_a_bot_that_fills_the_hidden_field_gets_a_success_and_nothing_is_stored(api):
    res = send(api, {**GOOD, "website": "http://spam.example"})
    assert res.status_code == 201 and api.sql("select count(*) from support_tickets")[0][0] == 0


def test_control_characters_are_removed(api):
    send(api, {**GOOD, "message": "Hello\x00 there\x07, this is long enough."})
    assert api.sql("select message from support_tickets")[0][0] == "Hello there, this is long enough."


def test_the_same_email_and_address_are_rate_limited(api):
    codes = [send(api, {**GOOD, "message": f"Message number {i} is long enough."}).status_code for i in range(4)]
    assert codes == [201, 201, 201, 429]   # 3 per email per hour
    # The blocked attempt counted against the address too, so only one more message fits in its 5 per hour.
    other = [send(api, {**GOOD, "email": f"p{i}@example.org"}).status_code for i in range(4)]
    assert other == [201, 429, 429, 429] and api.sql("select count(*) from support_tickets")[0][0] == 4


def test_a_daily_cap_per_address_is_kept_in_the_database(api, monkeypatch):
    from summarizer.features.support import router as support_router
    monkeypatch.setattr(support_router, "MAX_PER_IP_PER_DAY", 1)
    assert send(api).status_code == 201
    res = send(api, {**GOOD, "email": "other@example.org"})
    assert res.status_code == 429


def test_the_team_is_told_by_email_only_when_configured(api, monkeypatch):
    from summarizer.features.support import mail
    sent = []
    monkeypatch.setattr(mail, "_send", lambda to, subject, text, markup, reply_to=None, client=None: sent.append((to, subject, reply_to)) or True)
    send(api)
    assert sent == []                                              # not configured: tickets only
    set_env(monkeypatch, SUPPORT_NOTIFY_EMAIL="team@example.org", RESEND_API_KEY="k")
    send(api, {**GOOD, "email": "second@example.org"})
    assert sent == [("team@example.org", "[Support] Upload fails", "second@example.org")]


def test_the_visitors_text_is_escaped_in_the_email_to_the_team(monkeypatch):
    from summarizer.features.support import mail
    set_env(monkeypatch, SUPPORT_NOTIFY_EMAIL="team@example.org", RESEND_API_KEY="k")
    captured = {}
    monkeypatch.setattr(mail, "_send", lambda to, subject, text, markup, reply_to=None, client=None: captured.update(markup=markup) or True)
    mail.notify_team("abc", email="a@example.org", name="<b>x</b>", category="bug", subject="s",
                     message="<script>alert(1)</script> and more words")
    assert "<script>" not in captured["markup"] and "&lt;script&gt;" in captured["markup"]


def test_no_automatic_reply_goes_to_the_sender(api, monkeypatch):
    """The form is open to anyone, so an automatic acknowledgement would let a stranger make us email any address."""
    from summarizer.features.support import mail
    set_env(monkeypatch, SUPPORT_NOTIFY_EMAIL="team@example.org", RESEND_API_KEY="k")
    recipients = []
    monkeypatch.setattr(mail, "_send", lambda to, *a, **k: recipients.append(to) or True)
    send(api)
    assert recipients == ["team@example.org"]


def test_deleting_an_account_deletes_its_messages_and_the_export_includes_them(api):
    me = api.user()
    send(api, headers=me.headers)
    export = api.client.get("/api/me/export", headers=me.headers).json()
    assert [t["subject"] for t in export["support_tickets"]] == ["Upload fails"]
    assert "ip_hash" not in export["support_tickets"][0]
    assert api.client.request("DELETE", "/api/me", headers=me.headers, json={"confirm": "DELETE"}).status_code == 200
    assert api.sql("select count(*) from support_tickets")[0][0] == 0
