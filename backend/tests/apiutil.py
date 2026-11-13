"""Helpers for tests that run the real API against a throwaway database."""
import io
import uuid
from dataclasses import dataclass, field

import psycopg
from fastapi.testclient import TestClient

from conftest import make_token


@dataclass
class User:
    id: str
    token: str

    @property
    def headers(self):
        return {"Authorization": f"Bearer {self.token}"}


@dataclass
class Api:
    client: TestClient
    db_url: str
    users: list = field(default_factory=list)

    def user(self, with_email=True) -> User:
        """A signed-in account (Google or email). `with_email=False` makes one without an address."""
        uid = uuid.uuid4()
        with psycopg.connect(self.db_url, autocommit=True) as conn:
            conn.execute("insert into auth.users (id, email, is_anonymous) values (%s, %s, false)",
                         (uid, f"{uid}@example.com" if with_email else None))
        return User(str(uid), make_token(uid, extra={"email": f"{uid}@example.com"} if with_email else None))

    @staticmethod
    def anonymous_headers() -> dict:
        """A guest token for a user that does not exist in the database."""
        return {"Authorization": f"Bearer {make_token(anonymous=True)}"}

    def guest(self) -> User:
        """A guest (Supabase anonymous sign-in): a real auth user with is_anonymous = true."""
        uid = uuid.uuid4()
        with psycopg.connect(self.db_url, autocommit=True) as conn:
            conn.execute("insert into auth.users (id, email, is_anonymous) values (%s, null, true)", (uid,))
        return User(str(uid), make_token(uid, anonymous=True))

    def upgrade(self, guest: User) -> User:
        """The guest signs in with Google: same user id, no longer anonymous."""
        with psycopg.connect(self.db_url, autocommit=True) as conn:
            conn.execute("update auth.users set is_anonymous = false, email = %s where id = %s",
                         (f"{guest.id}@example.com", guest.id))
        return User(guest.id, make_token(guest.id, extra={"email": f"{guest.id}@example.com"}))

    def sql(self, query, params=()):
        with psycopg.connect(self.db_url, autocommit=True) as conn:
            cur = conn.execute(query, params)
            return cur.fetchall() if cur.description else None

    def submit(self, user: User, n=0, **kwargs):
        headers = kwargs.pop("headers", user.headers)
        return self.client.post("/api/summarize/url", headers=headers,
                                json={"url": youtube_url(n)}, **kwargs)

    def upload(self, user: User, name="lecture.mp4", content=b"data", **kwargs):
        return self.client.post("/api/summarize/upload", headers=user.headers,
                                files={"file": (name, io.BytesIO(content), "video/mp4")}, **kwargs)


def youtube_url(n: int) -> str:
    """A valid-looking YouTube URL with an 11-character id derived from n."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    code = ""
    for _ in range(11):
        code += alphabet[n % len(alphabet)]
        n //= len(alphabet)
    return f"https://www.youtube.com/watch?v={code}"


SUMMARY = "# Video Summary\n\n## 1. Main Topic\nIt works.\n\n## 2. Key Concepts\n- Term: its meaning\n- Other: more"


def make_deps(tmp_path, **overrides):
    """Fake YouTube / Whisper / AI so the real job flow can run without a network."""
    from pathlib import Path

    from summarizer.features.jobs.runner import PipelineDeps
    from summarizer.shared.storage import LocalFileStore

    calls = {"summarize": 0, "whisper": 0, "captions": 0}

    def summarize(transcript):
        calls["summarize"] += 1
        return SUMMARY, "Fake (test-model)"

    def captions(url):
        calls["captions"] += 1
        return "hello world transcript"

    def whisper_url(url, job_id):
        calls["whisper"] += 1
        return "spoken words"

    deps = PipelineDeps(
        fetch_metadata=lambda url: ("Test Video", 120),
        fetch_captions=captions,
        transcribe_youtube=whisper_url,
        transcribe_file=lambda path, job_id: f"transcript of {Path(path).stat().st_size} bytes",
        summarize=summarize,
        to_roman=lambda text: text,
        file_store=LocalFileStore(tmp_path / "data" / "uploads"),
    )
    for name, value in overrides.items():
        setattr(deps, name, value)
    deps.calls = calls
    return deps


def ready_video(api, user, tmp_path, n=1):
    """Submit a video and run the worker so it is fully processed. Returns its id."""
    from summarizer.features.jobs import worker

    job_id = api.submit(user, n).json()["job_id"]
    worker.run_once(make_deps(tmp_path), "test-worker")
    job = api.client.get(f"/api/job/{job_id}", headers=user.headers).json()
    assert job["status"] == "completed", job
    return job["video_id"]


def age_session(api, session_id, seconds):
    """Pretend `seconds` have passed since the last heartbeat (study time is measured by the server)."""
    api.sql("update study_sessions set last_heartbeat_at = now() - make_interval(secs => %s) where id = %s",
            (seconds, session_id))
    api.sql("update profiles set study_credited_until = now() - make_interval(secs => %s) "
            "where user_id = (select user_id from study_sessions where id = %s)", (seconds, session_id))


def study(api, user, seconds, video=None):
    """Start a session and credit `seconds` of study to the user. Returns the heartbeat response."""
    body = {"video_id": video} if video else None
    sid = api.client.post("/api/study/sessions", headers=user.headers, json=body).json()["id"]
    age_session(api, sid, seconds)
    res = api.client.post(f"/api/study/sessions/{sid}/heartbeat", headers=user.headers, json={"active": True})
    assert res.status_code == 200, res.text
    return res.json()
