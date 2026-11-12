"""Checks that this app is connected to your Supabase project. Read-only: it creates and changes nothing,
and never prints a secret.

    python3 scripts/check_supabase.py

Each line says PASS, WARN (works, but look at it) or FAIL, and FAIL lines say exactly what to do.
"""
import json, os, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from dotenv import dotenv_values

backend = dotenv_values(os.path.join(ROOT, ".env"))
frontend = dotenv_values(os.path.join(ROOT, "frontend", ".env.local"))
URL = (backend.get("SUPABASE_URL") or "").strip().rstrip("/")
DB = backend.get("DATABASE_URL") or ""
PUB = (frontend.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or "").strip()
FRONT_URL = (frontend.get("NEXT_PUBLIC_SUPABASE_URL") or "").strip().rstrip("/")
failures = 0


def say(level, text, fix=""):
    global failures
    failures += level == "FAIL"
    print(f"{level:<5} {text}" + (f"\n      -> {fix}" if fix and level != "PASS" else ""))


def http(path, data=None, key=None, method="GET"):
    headers = {"Content-Type": "application/json"}
    if key:
        headers["apikey"] = key
    req = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}
    except Exception as e:  # network
        return 0, {"error": str(e)}


print("Backend settings (.env)")
say("PASS" if URL.startswith("https://") else "FAIL", "SUPABASE_URL is set", "Add SUPABASE_URL=https://<project-ref>.supabase.co to .env")
say("PASS" if DB.startswith("postgres") else "FAIL", "DATABASE_URL is set", "Supabase > Connect > Session pooler: copy the URI into .env as DATABASE_URL")
if ":6543/" in DB:
    say("WARN", "DATABASE_URL uses the transaction pooler (port 6543)", "Use the Session pooler (port 5432) or the direct connection; the job queue holds locks across statements")
say("PASS" if backend.get("SUPABASE_JWT_SECRET") or True else "WARN", "Token check: uses the project's public signing keys (no JWT secret needed)" if not backend.get("SUPABASE_JWT_SECRET") else "Token check: JWT secret set (HS256 allowed as well)")
file_store = (backend.get("FILE_STORE") or "local").lower()
if file_store == "supabase" and not backend.get("SUPABASE_SERVICE_ROLE_KEY"):
    say("FAIL", "FILE_STORE=supabase needs SUPABASE_SERVICE_ROLE_KEY", "Supabase > Project Settings > API Keys > service_role (secret). Put it in .env only, never in the frontend")
else:
    say("PASS", f"Files are kept with the '{file_store}' store" + (" (on this computer; set FILE_STORE=supabase for the cloud)" if file_store == "local" else ""))

print("\nFrontend settings (frontend/.env.local)")
say("PASS" if FRONT_URL and FRONT_URL == URL else "FAIL", "NEXT_PUBLIC_SUPABASE_URL matches the backend", "Both must be the same project URL")
kind = "publishable" if PUB.startswith("sb_publishable_") else "legacy anon" if PUB.count(".") == 2 else None
say("PASS" if kind else "FAIL", f"NEXT_PUBLIC_SUPABASE_ANON_KEY looks like a {kind} key" if kind else "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or not a publishable/anon key",
    "Use the publishable key (sb_publishable_...) from Project Settings > API Keys. Never the service_role key")
if PUB.startswith("sb_secret_") or "service_role" in PUB:
    say("FAIL", "A secret key is in the frontend settings", "Remove it now: anything in NEXT_PUBLIC_* is public")

print("\nSupabase project (network)")
status, settings = http("/auth/v1/settings", key=PUB)
if status == 200:
    say("PASS", "Project reachable and the publishable key is accepted")
    ext = settings.get("external", {})
    anon = ext.get("anonymous_users") or settings.get("anonymous_users")
    say("PASS" if not anon else "WARN", "Guests are off: anonymous sign-ins are disabled (the app requires Google or email)",
        "Dashboard > Authentication > Sign In / Providers > turn OFF 'Allow anonymous sign-ins'. The API refuses guest sessions anyway")
    say("PASS" if ext.get("email") else "FAIL", "Email sign-in (magic link) is enabled", "Authentication > Sign In / Providers > Email: turn it on")
    say("PASS" if ext.get("google") else "FAIL", "Google sign-in is enabled",
        "Authentication > Sign In / Providers > Google: turn it on and paste your Google OAuth client id and secret (Google Cloud console > Credentials > OAuth client, type Web application; add the callback URL Supabase shows as an authorized redirect URI)")
    say("PASS" if not settings.get("disable_signup") else "FAIL", "Sign-ups are allowed", "Authentication > Sign In / Providers: turn OFF 'Disable new user signups'")
else:
    say("FAIL", f"Could not read the project's auth settings (HTTP {status})", "Check SUPABASE_URL and the publishable key; make sure the project is not paused")
status, jwks = http("/auth/v1/.well-known/jwks.json")
say("PASS" if status == 200 and jwks.get("keys") else "WARN", "Public signing keys are published (the backend verifies tokens with them)",
    "If this is empty your project uses the older shared secret: set SUPABASE_JWT_SECRET in .env (Project Settings > JWT)")

print("\nRedirect URLs (cannot be read from here: check them by hand)")
say("WARN", "Authentication > URL Configuration: Site URL and Redirect URLs",
    "Site URL http://localhost:3000 and Redirect URLs http://localhost:3000/auth/callback and http://127.0.0.1:3000/auth/callback (plus your real domain later). Without them Google and email links cannot come back to the app")

print("\nDatabase")
if DB.startswith("postgres"):
    try:
        import psycopg
        with psycopg.connect(DB, connect_timeout=15) as c:
            say("PASS", "Connected to Postgres")
            tables = {r[0] for r in c.execute("select table_name from information_schema.tables where table_schema='public'")}
            expected = {"profiles", "videos", "user_videos", "transcripts", "summaries", "jobs", "video_outputs", "share_links", "study_sessions",
                        "daily_stats", "goals", "notes", "playlists", "playlist_items", "notifications", "documents", "video_uploads", "user_edits", "user_outputs"}
            missing = sorted(expected - tables)
            say("PASS" if not missing else "FAIL", f"All {len(expected)} app tables exist" if not missing else f"Missing tables: {', '.join(missing)}",
                "Apply every file in supabase/migrations/ in order (SQL Editor, or `supabase db push`)")
            cols = {r[0] for r in c.execute("select table_name||'.'||column_name from information_schema.columns where table_schema='public'")}
            newest = {"documents.playlist_item_id", "daily_stats.pomodoros", "playlist_items.document_id"}
            say("PASS" if newest <= cols else "FAIL", "Latest migrations (files beside videos, study v2) are applied" if newest <= cols else "Latest migrations are missing",
                "Apply 20261110000010_playlist_documents.sql and 20261110000011_study_v2.sql")
            unprotected = [r[0] for r in c.execute("select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity")]
            say("PASS" if not unprotected else "FAIL", "Row-level security is on for every table" if not unprotected else f"No row-level security on: {', '.join(unprotected)}",
                "Run: alter table public.<name> enable row level security;")
            bucket = c.execute("select public from storage.buckets where id = %s", (backend.get("SUPABASE_STORAGE_BUCKET") or "uploads",)).fetchone()
            say("PASS" if bucket and not bucket[0] else "WARN" if bucket else "WARN", "Storage bucket 'uploads' exists and is private" if bucket and not bucket[0] else "Storage bucket missing or public",
                "Only matters for FILE_STORE=supabase. Apply 20261110000004_storage.sql")
            users = c.execute("select count(*), count(*) filter (where is_anonymous) from auth.users").fetchone()
            say("PASS" if users[1] == 0 else "WARN", f"{users[0]} user(s) so far" if users[1] == 0 else f"{users[1]} old guest account(s) still exist (they can no longer sign in)",
                "Their data is unreachable now. To remove them: delete from auth.users where is_anonymous (this also deletes their videos, notes and files rows)")
    except Exception as e:
        say("FAIL", f"Could not connect to the database: {type(e).__name__}", "Check the password in DATABASE_URL (Supabase > Connect), and that the project is not paused")

print()
print("Everything needed is connected." if not failures else f"{failures} thing(s) to fix (see the -> lines).")
sys.exit(1 if failures else 0)
