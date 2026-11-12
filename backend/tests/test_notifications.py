"""Notifications: delivery channels, preferences, quiet hours, push safety, reminders."""
import types
import uuid

import httpx
import pytest

from apiutil import ready_video
from conftest import set_env
from summarizer.core.db import connection
from summarizer.features.notifications import delivery, email, push
from summarizer.features.notifications import repository as repo
from summarizer.features.notifications.delivery import notify
from summarizer.features.study import reminders

FCM = "https://fcm.googleapis.com/fcm/send/abc123"
KEYS = {"p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", "auth": "tBHItJI5svbpez7KI4CCXg"}


@pytest.fixture(autouse=True)
def inline_delivery(monkeypatch):
    monkeypatch.setattr(delivery, "_submit", lambda func, *args: func(*args))
    sent = {"email": [], "push": []}
    # Replace the channels only inside the delivery module, so the real email/push code stays testable.
    monkeypatch.setattr(delivery, "email_channel",
                        types.SimpleNamespace(send_notification_email=lambda *a: sent["email"].append(a) or True))
    monkeypatch.setattr(delivery, "push_channel",
                        types.SimpleNamespace(send_to_subscription=lambda *a: sent["push"].append(a) or True))
    return sent


def listing(api, user):
    return api.client.get("/api/notifications", headers=user.headers).json()


def settings(api, user, **body):
    return api.client.put("/api/notifications/settings", headers=user.headers, json=body)


def subscribe(api, user, endpoint=FCM, keys=None):
    return api.client.post("/api/push/subscribe", headers=user.headers, json={"endpoint": endpoint, "keys": keys or KEYS})


@pytest.fixture()
def push_enabled(monkeypatch):
    set_env(monkeypatch, VAPID_PUBLIC_KEY="public-key-value", VAPID_PRIVATE_KEY="private-key-value")


# ------------------------------------------------------------ in-app basics

def test_default_notification_is_in_app_only(api, inline_delivery):
    user = api.user()
    row = notify(user.id, "goal_reached", "Goal!", "You did it", "/study")
    assert row["title"] == "Goal!"
    data = listing(api, user)
    assert data["unread"] == 1 and data["items"][0]["title"] == "Goal!" and data["items"][0]["read"] is False
    assert inline_delivery == {"email": [], "push": []}


def test_dedupe_key_creates_and_sends_only_once(api, inline_delivery):
    user = api.user()
    settings(api, user, prefs={"goal_reached": {"email": True}})
    assert notify(user.id, "goal_reached", "T", dedupe_key="k1") is not None
    assert notify(user.id, "goal_reached", "T", dedupe_key="k1") is None
    assert len(listing(api, user)["items"]) == 1 and len(inline_delivery["email"]) == 1
    assert notify(user.id, "goal_reached", "T", dedupe_key="k2") is not None  # a different key is a new notification


def test_turning_off_in_app_hides_it_but_still_prevents_duplicates(api, inline_delivery):
    user = api.user()
    settings(api, user, prefs={"goal_reached": {"in_app": False, "email": True}})
    assert notify(user.id, "goal_reached", "T", dedupe_key="day") is not None
    assert listing(api, user) == {"items": [], "unread": 0}
    assert len(inline_delivery["email"]) == 1
    assert notify(user.id, "goal_reached", "T", dedupe_key="day") is None  # no second email either


def test_listing_marking_read_and_privacy(api):
    alice, bob = api.user(), api.user()
    ids = [notify(alice.id, "summary_ready", f"n{i}")["id"] for i in range(3)]
    notify(bob.id, "summary_ready", "bob's")
    assert listing(api, alice)["unread"] == 3
    res = api.client.post("/api/notifications/read", headers=alice.headers, json={"ids": [str(ids[0])]})
    assert res.json() == {"unread": 2}
    api.client.post("/api/notifications/read", headers=bob.headers, json={"ids": [str(ids[1])]})  # not Bob's: ignored
    assert listing(api, alice)["unread"] == 2
    assert api.client.post("/api/notifications/read", headers=alice.headers, json={"all": True}).json() == {"unread": 0}
    assert listing(api, bob)["unread"] == 1
    assert api.client.post("/api/notifications/read", headers=alice.headers, json={}).status_code == 400
    assert api.client.post("/api/notifications/read", headers=alice.headers, json={"ids": ["junk"]}).json() == {"unread": 0}


def test_list_limit_and_order(api):
    user = api.user()
    for i in range(5):
        notify(user.id, "summary_ready", f"n{i}")
    items = api.client.get("/api/notifications?limit=3", headers=user.headers).json()["items"]
    assert [i["title"] for i in items] == ["n4", "n3", "n2"]  # newest first
    assert api.client.get("/api/notifications?limit=0", headers=user.headers).status_code == 422
    assert api.client.get("/api/notifications?limit=101", headers=user.headers).status_code == 422


# ----------------------------------------------------------------- settings

def test_settings_defaults_and_changes(api):
    user = api.user()
    data = api.client.get("/api/notifications/settings", headers=user.headers).json()
    assert data["prefs"]["goal_reached"] == {"in_app": True, "email": False, "push": False}
    assert (data["reminder_hour"], data["quiet_start"], data["quiet_end"]) == (20, None, None)
    assert data["email_available"] is False and data["push_available"] is False and data["push_subscribed"] is False
    out = settings(api, user, prefs={"streak_at_risk": {"email": True, "push": True}}, reminder_hour=9, quiet_start=22, quiet_end=7).json()
    assert out["prefs"]["streak_at_risk"] == {"in_app": True, "email": True, "push": True}
    assert (out["reminder_hour"], out["quiet_start"], out["quiet_end"]) == (9, 22, 7)
    assert settings(api, user, clear_quiet_hours=True).json()["quiet_start"] is None


@pytest.mark.parametrize("body", [{"quiet_start": 22}, {"quiet_end": 7}, {"reminder_hour": 24}, {"quiet_start": -1, "quiet_end": 3},
                                  {"prefs": {"spam": {"email": True}}}, {"prefs": {"goal_reached": {"sms": True}}},
                                  {"prefs": {"goal_reached": {"email": "yes please"}}}])
def test_invalid_settings_are_rejected(api, body):
    user = api.user()
    assert settings(api, user, **body).status_code in (400, 422)
    assert api.sql("select count(*) from notification_prefs")[0][0] == 0


def test_settings_are_per_user(api):
    alice, bob = api.user(), api.user()
    settings(api, alice, prefs={"goal_reached": {"email": True}}, quiet_start=1, quiet_end=2)
    data = api.client.get("/api/notifications/settings", headers=bob.headers).json()
    assert data["prefs"]["goal_reached"]["email"] is False and data["quiet_start"] is None


# ---------------------------------------------------------------- quiet hours

@pytest.mark.parametrize("hour,start,end,expected", [
    (23, 22, 7, True), (3, 22, 7, True), (7, 22, 7, False), (21, 22, 7, False), (22, 22, 7, True),
    (12, 9, 17, True), (17, 9, 17, False), (8, 9, 17, False),
    (5, None, None, False), (5, 3, None, False), (5, 4, 4, False),
])
def test_quiet_hour_rules(hour, start, end, expected):
    assert repo.in_quiet_hours(hour, start, end) is expected


def test_quiet_hours_silence_email_and_push_but_keep_the_in_app_copy(api, inline_delivery, push_enabled):
    user = api.user()
    subscribe(api, user)
    settings(api, user, prefs={"goal_reached": {"email": True, "push": True}}, quiet_start=0, quiet_end=23)
    api.sql("update profiles set timezone = 'UTC' where user_id = %s", (user.id,))
    hour = api.sql("select extract(hour from now() at time zone 'UTC')::int")[0][0]
    if hour == 23:
        pytest.skip("the quiet window 0-23 does not include 23:00")
    notify(user.id, "goal_reached", "Quiet one")
    assert len(listing(api, user)["items"]) == 1
    assert inline_delivery == {"email": [], "push": []}
    settings(api, user, clear_quiet_hours=True)
    notify(user.id, "goal_reached", "Loud one")
    assert len(inline_delivery["email"]) == 1 and len(inline_delivery["push"]) == 1


# ----------------------------------------------------------------- email

def test_email_goes_only_to_users_with_an_address_and_the_preference(api, inline_delivery):
    member, no_email = api.user(), api.user(with_email=False)
    for user in (member, no_email):
        settings(api, user, prefs={"summary_ready": {"email": True}})
        notify(user.id, "summary_ready", "Ready", "Body", "/video/1")
    assert [m[0] for m in inline_delivery["email"]] == [f"{member.id}@example.com"]
    assert len(listing(api, no_email)["items"]) == 1


def test_email_is_not_sent_without_the_preference(api, inline_delivery):
    user = api.user()
    notify(user.id, "summary_ready", "Ready")
    assert inline_delivery["email"] == []


def test_email_content_is_escaped_and_links_are_built_safely(monkeypatch):
    set_env(monkeypatch, APP_URL="https://app.example.com/")
    text, markup = email.render('<script>alert(1)</script>', "Tom & <b>Jerry</b>", "/study")
    assert "<script>" not in markup and "&lt;script&gt;" in markup and "&amp;" in markup and "<b>" not in markup
    assert "https://app.example.com/study" in text and "href='https://app.example.com/study'" in markup
    _, no_link = email.render("T", None, "https://evil.example/phish")  # only app-relative links are linked
    assert "evil.example" not in no_link


def test_resend_request_shape_and_failure_handling(monkeypatch):
    set_env(monkeypatch, RESEND_API_KEY="re_test", EMAIL_FROM="Study <study@example.com>", APP_URL="https://app.test")
    seen = {}

    class Client:
        def post(self, url, json=None, headers=None, timeout=None):
            seen.update(url=url, json=json, headers=headers)
            return httpx.Response(200, json={"id": "x"}, request=httpx.Request("POST", url))

    assert email.send_notification_email("a@b.co", "Hi", "There", "/study", Client()) is True
    assert seen["url"] == "https://api.resend.com/emails" and seen["headers"]["Authorization"] == "Bearer re_test"
    assert seen["json"]["to"] == ["a@b.co"] and seen["json"]["from"] == "Study <study@example.com>" and seen["json"]["subject"] == "Hi"

    class Rejecting:
        def post(self, url, **kw):
            return httpx.Response(422, json={}, request=httpx.Request("POST", url))

    class Down:
        def post(self, url, **kw):
            raise httpx.ConnectError("down")

    assert email.send_notification_email("a@b.co", "Hi", None, None, Rejecting()) is False
    assert email.send_notification_email("a@b.co", "Hi", None, None, Down()) is False


def test_email_is_off_without_an_api_key():
    assert email.email_available() is False
    assert email.send_notification_email("a@b.co", "Hi", None, None) is False


# -------------------------------------------------------------------- push

@pytest.mark.parametrize("endpoint,ok", [
    (FCM, True),
    ("https://updates.push.services.mozilla.com/wpush/v2/abc", True),
    ("https://web.push.apple.com/abc", True),
    ("https://wns2-par02p.notify.windows.com/w/?token=abc", True),
    ("http://fcm.googleapis.com/fcm/send/abc", False),
    ("https://localhost/x", False), ("https://127.0.0.1/x", False), ("https://169.254.169.254/latest/meta-data", False),
    ("https://10.0.0.5/x", False), ("https://internal.service.local/x", False),
    ("https://fcm.googleapis.com.evil.com/x", False), ("https://evilgoogleapis.com/x", False),
    ("https://user:pass@fcm.googleapis.com/x", False), ("https://fcm.googleapis.com:8443/x", False),
    ("ftp://fcm.googleapis.com/x", False), ("javascript:alert(1)", False), ("", False), ("https://", False),
    ("https://fcm.googleapis.com/" + "a" * 1000, False),
])
def test_only_real_push_services_are_accepted(endpoint, ok):
    assert push.is_allowed_endpoint(endpoint) is ok


def test_subscribing_and_unsubscribing(api, push_enabled):
    user = api.user()
    assert api.client.get("/api/push/public-key", headers=user.headers).json() == {"public_key": "public-key-value"}
    assert subscribe(api, user).status_code == 204
    assert subscribe(api, user).status_code == 204  # the same browser again is fine
    assert api.sql("select count(*) from push_subscriptions")[0][0] == 1
    assert api.client.get("/api/notifications/settings", headers=user.headers).json()["push_subscribed"] is True
    assert api.client.post("/api/push/unsubscribe", headers=user.headers, json={"endpoint": FCM}).status_code == 204
    assert api.sql("select count(*) from push_subscriptions")[0][0] == 0


def test_a_malicious_subscription_address_is_refused(api, push_enabled):
    user = api.user()
    for endpoint in ("https://169.254.169.254/latest", "http://fcm.googleapis.com/x", "https://localhost:9200/_search"):
        assert subscribe(api, user, endpoint).status_code == 422
    assert api.sql("select count(*) from push_subscriptions")[0][0] == 0


def test_subscription_keys_are_validated(api, push_enabled):
    user = api.user()
    assert subscribe(api, user, keys={"p256dh": "x", "auth": "y"}).status_code == 422
    assert subscribe(api, user, keys={"p256dh": KEYS["p256dh"]}).status_code == 422


def test_one_browser_cannot_be_subscribed_for_two_users_and_takeover_moves_it(api, push_enabled):
    alice, bob = api.user(), api.user()
    subscribe(api, alice)
    subscribe(api, bob)  # the same browser endpoint now belongs to whoever signed in last
    assert api.sql("select user_id::text from push_subscriptions")[0][0] == bob.id
    assert api.client.get("/api/notifications/settings", headers=alice.headers).json()["push_subscribed"] is False


def test_at_most_ten_browsers_per_user(api, push_enabled):
    user = api.user()
    for i in range(10):
        assert subscribe(api, user, f"https://fcm.googleapis.com/fcm/send/{i}").status_code == 204
    assert subscribe(api, user, "https://fcm.googleapis.com/fcm/send/extra").status_code == 409
    assert subscribe(api, user, "https://fcm.googleapis.com/fcm/send/3").status_code == 204  # re-subscribing an existing one is fine


def test_push_is_unavailable_without_keys(api):
    user = api.user()
    assert api.client.get("/api/push/public-key", headers=user.headers).status_code == 404
    assert subscribe(api, user).status_code == 404


def test_push_sends_with_the_right_payload_and_cleans_up_dead_subscriptions(api, push_enabled):
    user = api.user()
    subscribe(api, user)
    sub = {"endpoint": FCM, **KEYS}
    calls = []

    def ok(info, data):
        calls.append((info, data))
        return 201

    assert push.send_to_subscription(sub, "Title", "Body", "/study", sender=ok) is True
    info, data = calls[0]
    assert info["endpoint"] == FCM and info["keys"] == KEYS
    assert '"url": "/study"' in data and '"title": "Title"' in data
    assert api.sql("select last_success_at is not null from push_subscriptions")[0][0] is True

    assert push.send_to_subscription(sub, "T", None, None, sender=lambda i, d: 500) is False
    assert api.sql("select count(*) from push_subscriptions")[0][0] == 1  # a temporary error keeps it
    assert push.send_to_subscription(sub, "T", None, None, sender=lambda i, d: 410) is False
    assert api.sql("select count(*) from push_subscriptions")[0][0] == 0  # "gone" removes it


def test_push_refuses_to_contact_an_unlisted_address_even_if_one_is_stored(api, push_enabled):
    called = []
    sub = {"endpoint": "https://169.254.169.254/x", **KEYS}
    assert push.send_to_subscription(sub, "T", None, None, sender=lambda i, d: called.append(1) or 201) is False
    assert called == []


# ---------------------------------------------------------------- reminders

def seed_streak(api, user, days=(1, 2), seconds=600):
    for d in days:
        api.sql("insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone 'UTC')::date - %s, %s)",
                (user.id, d, seconds))
    api.sql("update profiles set reminder_hour = 0, timezone = 'UTC' where user_id = %s", (user.id,))


def test_streak_reminder_is_sent_once_per_day(api, inline_delivery):
    user, no_streak, done = api.user(), api.user(), api.user()
    seed_streak(api, user)
    seed_streak(api, done)
    api.sql("insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone 'UTC')::date, 700)", (done.id,))
    api.sql("update profiles set reminder_hour = 0 where user_id = %s", (no_streak.id,))
    assert reminders.send_streak_reminders() == 1
    items = listing(api, user)["items"]
    assert [i["type"] for i in items] == ["streak_at_risk"] and "2-day" in items[0]["title"]
    assert listing(api, no_streak)["items"] == [] and listing(api, done)["items"] == []
    assert reminders.send_streak_reminders() == 0  # already reminded today


def test_reminders_respect_notification_preferences_and_channels(api, inline_delivery):
    user = api.user()
    seed_streak(api, user)
    settings(api, user, prefs={"streak_at_risk": {"in_app": False, "email": True}})
    reminders.send_streak_reminders()
    assert listing(api, user)["items"] == [] and len(inline_delivery["email"]) == 1
    assert reminders.send_streak_reminders() == 0


def test_summary_ready_notification_after_processing(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    items = listing(api, user)["items"]
    assert [i["type"] for i in items] == ["summary_ready"]
    assert items[0]["link"] == f"/video/{video}" and items[0]["body"] == "Test Video"


def test_a_notification_failure_never_breaks_the_job(api, tmp_path, monkeypatch):
    from summarizer.features.jobs import worker
    from apiutil import make_deps

    def boom(*args, **kwargs):
        raise RuntimeError("notification service exploded")

    monkeypatch.setattr(worker, "notify", boom)
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    worker.run_once(make_deps(tmp_path), "w")
    assert api.client.get(f"/api/job/{job_id}", headers=user.headers).json()["status"] == "completed"


def test_delivery_errors_in_the_background_are_contained(monkeypatch):
    calls = []
    monkeypatch.setattr(delivery.logger, "exception", lambda *a, **k: calls.append(1))
    delivery._safe(lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert calls == [1]


def test_unknown_notification_type_is_rejected_by_the_database(api):
    user = api.user()
    with pytest.raises(Exception):
        with connection() as conn:
            repo.create_notification(conn, user.id, "spam", "t", None, None, None)
    assert uuid.UUID(user.id)
