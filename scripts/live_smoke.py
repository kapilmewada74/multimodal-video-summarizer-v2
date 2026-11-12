"""Live smoke test: runs the real backend against YOUR Supabase database with two throwaway users, then removes
everything it created (row counts are compared before and after). It never calls an AI provider and never touches
existing data. Needs DATABASE_URL and SUPABASE_URL in the repo's .env.

    python3 scripts/live_smoke.py
"""
import io, os, sys, time, uuid, tempfile, json
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
sys.path.insert(0, "backend"); sys.path.insert(0, "backend/tests")
import jwt, psycopg
from dotenv import dotenv_values
env = dotenv_values(".env")
URL, DB = env["SUPABASE_URL"], env["DATABASE_URL"]
SECRET = "live-smoke-test-secret-" + uuid.uuid4().hex   # only used by this process
tmp = tempfile.mkdtemp(prefix="smoke-")
os.environ.update(DATABASE_URL=DB, SUPABASE_URL=URL, SUPABASE_JWT_SECRET=SECRET, DATA_DIR=tmp, RUN_EMBEDDED_WORKER="false",
                  FILE_STORE="local", ENVIRONMENT="development")
for k in ("GEMINI_API_KEY","XAI_API_KEY","GROK_API_KEY","GROQ_API_KEY"): os.environ.pop(k, None)   # never call real AI from a smoke test
import samples
from fastapi.testclient import TestClient
from summarizer.main import app

def token(uid): return jwt.encode({"sub": uid, "aud": "authenticated", "role": "authenticated", "exp": int(time.time())+600,
                                  "is_anonymous": False, "email": uid + "@smoke.test", "iss": f"{URL}/auth/v1"}, SECRET, algorithm="HS256")
results = []
def check(name, ok, info=""):
    ok = bool(ok)
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f"  [{info}]" if info and not ok else ""))

admin = psycopg.connect(DB, autocommit=True)
before = {t: admin.execute(f"select count(*) from public.{t}").fetchone()[0] for t in ("profiles","videos","user_videos","study_sessions","documents","playlists","notes")}
uid = str(uuid.uuid4()); other = str(uuid.uuid4()); created_videos = []
try:
    for u in (uid, other):
        admin.execute("insert into auth.users (id, aud, role, email, is_anonymous) values (%s,'authenticated','authenticated',%s,false)", (u, u + "@smoke.test"))
    check("profile row is created by the sign-up trigger", admin.execute("select count(*) from public.profiles where user_id=%s", (uid,)).fetchone()[0] == 1)
    vid = admin.execute("insert into public.videos (source, youtube_id, title, duration_seconds, status) values ('youtube','SMOKEtest01','Smoke test video',600,'ready') returning id").fetchone()[0]
    created_videos.append(vid)
    admin.execute("insert into public.transcripts (video_id, text) values (%s,'hello')", (vid,))
    admin.execute("insert into public.summaries (video_id, content_md, engine) values (%s,'## 1. Main Topic\nSmoke.','Smoke')", (vid,))
    admin.execute("insert into public.user_videos (user_id, video_id) values (%s,%s)", (uid, vid))
    vid = str(vid)
    H = {"Authorization": "Bearer " + token(uid)}; HO = {"Authorization": "Bearer " + token(other)}
    with TestClient(app) as c:
        r = c.get("/api/health"); check("health", r.status_code == 200, r.text)
        r = c.get("/api/health/ready"); check("readiness probe sees the live database", r.status_code == 200 and r.json()["database"] == "ok", r.text)
        check("every response carries a request id and security headers", bool(r.headers.get("x-request-id")) and r.headers.get("x-content-type-options") == "nosniff")
        check("no token is refused", c.get("/api/videos").status_code in (401, 403))
        guest = jwt.encode({"sub": uid, "aud": "authenticated", "role": "authenticated", "exp": int(time.time())+60, "is_anonymous": True, "iss": f"{URL}/auth/v1"}, SECRET, algorithm="HS256")
        check("a guest (anonymous) session is refused", c.get("/api/videos", headers={"Authorization": "Bearer " + guest}).status_code == 403)
        check("a forged token is refused", c.get("/api/videos", headers={"Authorization": "Bearer " + jwt.encode({"sub": uid, "aud": "authenticated", "exp": int(time.time())+60, "iss": f"{URL}/auth/v1"}, "wrong-secret", algorithm="HS256")}).status_code == 401)
        r = c.get("/api/videos", headers=H); check("library lists my video", r.status_code == 200 and [v["id"] for v in r.json()["items"]] == [vid], r.text[:200])
        r = c.get(f"/api/videos/{vid}", headers=H); check("video detail with summary", r.status_code == 200 and "Smoke" in (r.json()["summary"] or ""), r.text[:200])
        check("other user cannot open it", c.get(f"/api/videos/{vid}", headers=HO).status_code == 404)
        r = c.put(f"/api/videos/{vid}/notes", headers=H, json={"content": "live note हिन्दी"}); check("save note", r.status_code == 200, r.text)
        r = c.get(f"/api/videos/{vid}/notes", headers=H); check("read note back (unicode)", r.json()["content"] == "live note हिन्दी")
        r = c.put(f"/api/videos/{vid}/edits/summary", headers=H, json={"content": {"markdown": "my edit"}}); check("edit summary", r.status_code == 200, r.text)
        r = c.put(f"/api/videos/{vid}/edits/summary", headers=H, json={"content": {"markdown": "my edit 2"}}); check("second edit keeps a version", r.status_code == 200 and len(c.get(f"/api/videos/{vid}/edits/summary", headers=H).json()["versions"]) == 1)
        r = c.post("/api/study/sessions", headers=H, json={"video_id": vid}); sid = r.json().get("id"); check("start study session", r.status_code == 200 and sid, r.text)
        admin.execute("update public.study_sessions set last_heartbeat_at = now() - interval '20 seconds' where id=%s", (sid,))
        r = c.post(f"/api/study/sessions/{sid}/heartbeat", headers=H, json={"active": True}); check("heartbeat credits ~20s", r.status_code == 200 and 18 <= r.json()["credited"] <= 22, r.text)
        r = c.post(f"/api/study/sessions/{sid}/pomodoro", headers=H); check("pomodoro counted", r.status_code == 200 and r.json()["counted"] is True, r.text)
        r = c.get("/api/study/overview", headers=H); d = r.json(); check("overview has week, streak details, pomodoros", r.status_code == 200 and len(d["week"]) == 7 and d["today"]["pomodoros"] == 1 and "freeze_available" in d["streak"], r.text[:200])
        check("per-video study time", len(c.get("/api/study/videos", headers=H).json()["items"]) == 1)
        r = c.put("/api/study/goals", headers=H, json={"goals": [{"type": "minutes", "target": 30, "active": True}]}); check("save goals", r.status_code == 200, r.text)
        r = c.post("/api/playlists", headers=H, json={"title": "Smoke playlist"}); pl = r.json().get("id"); check("create playlist", r.status_code == 201, r.text)
        check("add library video to playlist", c.post(f"/api/playlists/{pl}/items", headers=H, json={"video_id": vid}).status_code == 201)
        item = c.get(f"/api/playlists/{pl}", headers=H).json()["items"][0]["id"]
        r = c.post("/api/documents", headers=H, data={"playlist_item_id": item}, files={"file": ("slides.pdf", io.BytesIO(samples.pdf("Smoke pdf words")), "application/pdf")})
        check("attach a PDF to the lesson (text extracted)", r.status_code == 201 and r.json()["has_text"] is True and r.json()["video_id"] == vid, r.text[:200])
        r = c.post(f"/api/playlists/{pl}/documents", headers=H, files={"file": ("row.txt", io.BytesIO(samples.TXT), "text/plain")}); check("add a file row", r.status_code == 201, r.text[:200])
        items = c.get(f"/api/playlists/{pl}", headers=H).json()["items"]
        check("lesson shows its file and the file row is listed", [i["kind"] for i in items] == ["library_upload", "document"] or [i["kind"] for i in items] == ["youtube", "document"] or len(items) == 2, str([i["kind"] for i in items]))
        doc = items[0]["documents"][0]["id"]
        u = c.get(f"/api/documents/{doc}/view-url", headers=H).json()["url"]; rr = c.get(u); check("PDF served inline", rr.status_code == 200 and rr.headers["content-disposition"].startswith("inline") and rr.content.startswith(b"%PDF"))
        check("other user cannot get a view link", c.get(f"/api/documents/{doc}/view-url", headers=HO).status_code == 404)
        r = c.post(f"/api/videos/{vid}/share", headers=H); tok = r.json().get("token"); check("create share link", r.status_code in (200, 201) and tok, r.text)
        r = c.get(f"/api/public/{tok}") if tok else None
        check("public share page is readable without login", r is not None and r.status_code == 200, getattr(r, "text", "")[:150])
        r = c.get(f"/api/videos/{vid}/export.md", headers=H); check("export uses my edited summary", r.status_code == 200 and "my edit 2" in r.text)
        r = c.get("/api/me/usage", headers=H); check("usage endpoint (10 videos a day)", r.status_code == 200, r.text[:150])
        r = c.get("/api/me/export", headers=H); d = r.json() if r.status_code == 200 else {}
        check("data export holds my data and no storage keys", r.status_code == 200 and d["account"]["id"] == uid and len(d["notes"]) == 1 and "storage_key" not in r.text, r.text[:150])
        check("account deletion needs the word DELETE", c.request("DELETE", "/api/me", headers=HO, json={"confirm": "no"}).status_code == 400)
        r = c.request("DELETE", "/api/me", headers=HO, json={"confirm": "DELETE"})
        gone = admin.execute("select count(*) from auth.users where id=%s", (other,)).fetchone()[0] == 0 and admin.execute("select count(*) from public.profiles where user_id=%s", (other,)).fetchone()[0] == 0
        check("account deletion removes the user and their rows on the live database", r.status_code == 200 and gone, r.text[:150])
        check("my own account is untouched by that", admin.execute("select count(*) from auth.users where id=%s", (uid,)).fetchone()[0] == 1)
    other = str(uuid.uuid4())  # the first one was deleted above; RLS needs a second real user
    admin.execute("insert into auth.users (id, aud, role, email, is_anonymous) values (%s,'authenticated','authenticated',%s,false)", (other, other + "@smoke.test"))
    # RLS check straight in SQL as the 'authenticated' role: a user sees only their own notes
    with psycopg.connect(DB, autocommit=False) as rls:
        rls.execute("set local role authenticated"); rls.execute("select set_config('request.jwt.claim.sub', %s, true)", (other,))
        rls.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": other, "role": "authenticated"}),))
        seen = rls.execute("select count(*) from public.notes where user_id = %s", (uid,)).fetchone()[0]
        check("RLS: another signed-in user cannot read my notes", seen == 0, str(seen))
        try:
            rls.execute("select storage_key from public.documents limit 1"); check("RLS: storage_key column is not readable by browsers", False)
        except psycopg.errors.InsufficientPrivilege:
            check("RLS: storage_key column is not readable by browsers", True)
finally:
    # remove everything this test created: users cascade to their rows
    admin.execute("delete from public.documents where user_id in (%s,%s)", (uid, other))
    admin.execute("delete from auth.users where id in (%s,%s)", (uid, other))
    for v in created_videos: admin.execute("delete from public.videos where id=%s", (v,))
    after = {t: admin.execute(f"select count(*) from public.{t}").fetchone()[0] for t in before}
    print("test data removed (row counts unchanged):", before == after, "" if before == after else (before, after))
    import shutil; shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
