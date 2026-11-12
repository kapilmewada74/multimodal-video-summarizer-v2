# Final Implementation Plan

Version 1.1, 2026-11-10. This replaces [PRODUCT_PLAN.md](PRODUCT_PLAN.md).

Decisions locked in:
- **Supabase** for Postgres, Google auth, storage and realtime.
- **Legal and YouTube terms** are handled by you. The plan does not cover them.
- **Dropped features:** click-to-seek transcript and chapters, chat with the video, spaced-repetition flashcards, notes with timestamp links, PWA, library search.
- **Runs on your local PC now.** Before public deployment it moves to a cloud server with a GPU (section 3.1).
- **No payment gateway** for now. No plans, billing or paywall in this version.
- **Code sandbox is later**, after launch.
- **Limit: 10 videos per user per day** (section 8).

---

## Status

| Phase | State |
|---|---|
| 0. Stabilize | Done (merged in PR #3) |
| 1. Foundation | Done in code and tests (see below). Not yet run against a live Supabase project. |
| 2. Video workspace | Done (merged in PR #5) |
| 3. Study tools | Done in code and tests, and exercised in a real browser against the real API and a real Postgres. Not run against a live Supabase project, a real YouTube playlist import, or real email/push. |

Phase 1 delivered: Supabase schema with Row Level Security and migrations, feature-based backend
(`backend/summarizer/`), Supabase JWT verification (HS256 and public-key), guests as anonymous users with
Google account linking, a Postgres job queue with separate workers and retries, the 10-videos-per-day limit
(atomic, per user time zone, our-side failures refunded), per-IP daily cap, shared video cache, map-reduce
summaries for long videos, a provider chain with fallback, Supabase Storage file store, Realtime progress in
the UI, and a usage badge. Deferred from the Phase 1 list: the Turnstile widget in the UI (the backend check
is done and off by default).

Sign-in decision (2026-11-12): guests and anonymous sign-in were removed. Sign-in is required (Google or an emailed link); the API refuses anonymous sessions; the guest-only bot check was removed. The older sections of this plan that describe guests are superseded by this.

Phase 4f delivered: study bar with a three-dot menu (focus timer with presets and custom lengths, pause tracking, goal for a visit), streak with one forgiven day per week, pomodoro counting, per-video study time, recent sessions, week strip and 12-week activity grid.

Phase 4e delivered: files live beside the videos (paperclip per video, file rows ordered like videos, drag files onto a video), an in-page viewer for PDF/pictures/text of the other formats, icon-only summary actions with a download menu, fixed navbar.

Phase 4d delivered: phone polish across every page (menu, lists, forms, playlist rows, tab bar, touch sizes), verified at six screen sizes.

Phase 4c delivered: documents as generation context (private per user), Save to Google Drive, four mind map views with zoom/pan/fit/full screen/PNG/SVG, and a phone layout (one scrolling page, pinned video). Phase 4 of the plan is now complete.

Phase 4b delivered: editable summary (Markdown with live preview) and editable slides (form editor), both per user with version history, restore, back-to-AI and conflict protection; Markdown export and PPTX export use the edits.

Phase 4 delivered: resizable video workspace (drag or keyboard divider, side by side or stacked, expand/collapse, reset, 16:9 kept, stacked on tablet and phone); documents of many formats attached to a video or standalone, with storage quota; video upload from the device in playlists (storage, playback, summarize hook; the summarize pipeline is untested with real Whisper).

Phase 3 delivered: a customized YouTube player (YouTube IFrame API with our own controls) that also appears on the
home page as soon as a link is pasted; server-measured study time with sessions and heartbeats; daily goals;
streaks (computed from daily totals; the weekly "freeze" is not built); video progress with resume and
completion; quiz history; typed notes with autosave; playlists (custom and YouTube import, fractional-key
drag-and-drop ordering); notifications (in-app, email through Resend, browser push) with per-type choices,
quiet hours, a streak reminder and a "summary ready" notice from the worker.

Phase 2 delivered: a page per video (`/video/[id]`) with the official YouTube player and every study tool,
including the new mind map; outputs generated once per video and stored for everyone (`video_outputs`),
with a per-user daily generation cap; a library page; public share links (`/s/[token]`, WhatsApp, revoke,
summary + mind map + flashcards only); Markdown export; the old uncapped stateless AI endpoints removed.
Deferred: a player for uploaded files (originals are deleted after processing, so YouTube videos only),
and PDF export beyond the browser print of the summary.

---

## 1. Scope

### Guest (no login)
- Paste a YouTube link or upload a file.
- Get summary, transcript, flashcards, quiz, slides and mind map.
- Copy, download (PDF / Markdown / PPTX), share via WhatsApp link.
- Limit: 10 videos per day (section 8), with a shorter maximum video length than signed-in users.

### Signed-in (Google)
Everything a guest gets, saved permanently, plus:
- Per-video workspace page (player + every output).
- Study timer, sessions, streaks, daily goals.
- Playlists with drag-to-reorder and per-video progress.
- Typed notes and uploaded notes (PDF, DOCX, PPTX, TXT, MD, images).
- Editable summary and editable slides.
- Notifications (in-app, email, web push).
- Share links and Google Drive export.

### Later (not in this version)
- Code sandbox beside the player.
- Payment gateway and paid plans.

### Not building
Everything in the dropped list above, plus: hosting or downloading videos for users, live-stream transcription, native apps, social feed, a canvas slide designer, a gamification shop.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Database | Supabase Postgres (with Row Level Security) |
| Auth | Supabase Auth: Google login + **anonymous sign-in** for guests |
| Files | Supabase Storage (private buckets, signed URLs) |
| Live progress | Supabase Realtime (replaces the 600 ms polling) |
| Job queue | Postgres `jobs` table with `FOR UPDATE SKIP LOCKED` (or Supabase Queues / pgmq). No Redis needed at launch. |
| Backend API | FastAPI (Python), stateless. **Now:** runs on your PC. **Deployed:** a container on a cloud server |
| Workers | Same codebase, run as separate processes (CPU worker, LLM worker, GPU worker) |
| Speech-to-text | faster-whisper. **Now:** your PC (CPU, or GPU if you have one). **Deployed:** a cloud GPU (section 3.1) |
| Frontend | Next.js 15 + Tailwind, deployed on Vercel |
| AI providers | Groq / Gemini / xAI behind one provider interface with fallback |
| Email | Resend |
| Web push | VAPID keys + `web-push` (notifications only, not a PWA) |
| Errors / analytics | Sentry, PostHog |
| CI | GitHub Actions |
| Payments | None for now |

**pgvector:** enable it later only if you add a feature that needs it. Chat and search are dropped, so nothing needs it now.

**Why Supabase fits:** one dashboard for DB, auth, storage and realtime. Anonymous sign-in gives guests a real user id, so **guest to Google upgrade keeps the same user id** (use `linkIdentity`). No data-merge code is required.

**What Supabase does not do:** run long Python jobs. Keep FastAPI and the workers on a normal container host.

---

## 3. Architecture

```
Next.js (Vercel)
  |-- supabase-js: auth, realtime progress, simple reads (protected by RLS)
  |-- HTTPS to FastAPI: ingest, generate, export, edit actions (JWT from Supabase)
        |
        v
FastAPI (Fly/Railway/Render) -- verifies Supabase JWT, checks limits
        |-- Supabase Postgres  (data + jobs queue)
        |-- Supabase Storage   (uploads, notes files, exports)
        |
Workers (same repo)
   CPU worker: yt metadata, captions, ffmpeg, text extraction, PPTX/PDF export
   LLM worker: summary, flashcards, quiz, mind map, slides
   GPU worker: Whisper transcription
        |-- write progress/status to jobs table --> Realtime --> browser
```

Rules:
1. The browser may read its own rows through supabase-js, but **all writes that cost money or change state go through FastAPI**.
2. FastAPI verifies the Supabase JWT on every request and uses the service key only inside the backend.
3. Every slow thing is a job. No threads, no global files, no in-memory state.
4. Per-job file paths only: `storage/{user_id}/{video_id}/...`.

### 3.1 Local first, then cloud GPU

**Stage 1: your PC (development and demos).**
- Run Supabase locally with the Supabase CLI (Docker), or point at a free hosted Supabase dev project.
- `docker compose up` starts the API and the workers. The Next.js app runs with `npm run dev`.
- Whisper uses your GPU if it has one (NVIDIA CUDA), otherwise the CPU with `int8`. On a Mac it runs on CPU, so use the `small` model and short test videos.
- Keep all config in environment variables, so the same containers move to the cloud unchanged.

**Stage 2: cloud server with a GPU (before public deployment).**
- Whisper is the only part that needs a GPU. The API, LLM calls (hosted APIs), ffmpeg and exports run fine on CPU.
- Rough GPU sizing for faster-whisper (verify with a benchmark on your own videos):

| Whisper model | Approx. GPU memory | Suggested GPU |
|---|---|---|
| `small` (current) | about 2 GB | any 8 GB+ card |
| `medium` | about 3 to 5 GB | 16 GB (T4 class) |
| `large-v3` (best accuracy for Hindi/Hinglish) | about 5 to 10 GB | 16 to 24 GB (T4 / L4 / A10 class) |

- With a 10-videos-per-day limit per user, traffic is small at first. Re-check once you have many daily users, since 100 active users could mean up to 1,000 videos a day. Start with **one 16 to 24 GB GPU**.
- Two ways to run it:
  - **Serverless GPU (Modal, RunPod serverless, Replicate):** you pay only while a job runs. Cheapest at low traffic. Cold starts of 10 to 60 seconds.
  - **Always-on GPU VM (AWS, GCP, Lambda, RunPod pod):** no cold start, but you pay 24/7. Choose it when daily volume makes it cheaper than serverless.
- Put the API and CPU workers on a small separate VM or container host. Do not put the web API on the GPU machine.
- Before choosing, run a benchmark: time the `small` and `large-v3` models on 5 of your real videos and compare accuracy and cost per minute of audio.

### Job flow
`queued -> fetching -> transcribing -> summarizing -> ready` (or `failed`).

1. `POST /videos` creates a `video` row and a `job` row, returns ids.
2. A worker claims the job, updates `jobs.status` and `progress`.
3. The browser subscribes to that `jobs` row through Realtime and shows live progress.
4. Flashcards, quiz, mind map and slides are separate jobs, created the first time the user opens that tab.
5. Jobs have timeouts, retries with backoff and a `failed` state with a readable error.

### Shared cache
Videos are keyed by `youtube_id` (or file hash for uploads). If a transcript or summary already exists, reuse it for all users. This is the largest cost saver.

---

## 4. Code layout (feature-based)

**Backend**
```
backend/app/
  main.py
  core/        config, db, auth (JWT verify), logging, errors
  shared/      llm providers, storage client, limits, pagination
  features/
    videos/        ingest (url/upload), status, cache lookup
    transcripts/   caption + whisper providers
    summaries/     generate, edit, versions
    flashcards/
    quizzes/
    mindmaps/
    slides/        slide JSON, PPTX/PDF export
    notes/         typed notes, uploaded files, text extraction
    playlists/     YouTube import, custom, ordering, progress
    study/         sessions, heartbeat, streaks, goals
    notifications/ in-app, email, push, scheduler
    sharing/       share links, WhatsApp, Drive export
    limits/        per-user video limit (10) and usage counters
  workers/       one task file per feature
  tests/         mirrors features/
```
Each feature has `router.py`, `schemas.py`, `service.py`, `tasks.py`, `tests/`. A feature may use `shared/` but never another feature's internals.

**Frontend**
```
frontend/src/
  app/             thin routes
  features/        ingest, video-player, summary, transcript, flashcards,
                   quiz, mindmap, slides, notes, playlists, study, notifications,
                   sharing, auth
  shared/          ui, hooks, api client, supabase client
```

Database changes live in `supabase/migrations/*.sql` (Supabase CLI), committed to git.

---

## 5. Database schema (Supabase Postgres)

All ids are UUIDs. `user_id` references `auth.users`. RLS is on for every table.

| Table | Key columns |
|---|---|
| `profiles` | user_id, display_name, timezone, daily_video_limit (default 10), is_anonymous |
| `videos` | id, source (`youtube`/`upload`), youtube_id (unique, nullable), file_hash, file_path, title, duration, language, status |
| `user_videos` | user_id, video_id, added_at, progress_seconds, status (`not_started`/`in_progress`/`done`) |
| `transcripts` | video_id, language, provider, text, segments JSONB (nullable) |
| `summaries` | id, video_id, content_md, model, created_at (shared AI version) |
| `user_summaries` | user_id, video_id, content_md, updated_at (user's edited copy) |
| `summary_versions` | id, user_summary_id, content_md, created_at |
| `flashcards` | id, video_id, front, back, tag |
| `quizzes` | id, video_id, difficulty, questions JSONB |
| `quiz_attempts` | id, user_id, quiz_id, answers JSONB, score, created_at |
| `mindmaps` | video_id, outline JSONB |
| `slide_decks` | id, video_id, user_id (null = shared AI version), slides JSONB, template, updated_at |
| `notes` | id, user_id, video_id, content (markdown/JSON), updated_at |
| `note_files` | id, user_id, video_id, file_path, mime, extracted_text, status |
| `playlists` | id, user_id, title, source (`youtube`/`custom`), source_id |
| `playlist_items` | playlist_id, video_id, position (text, fractional index), added_at |
| `study_sessions` | id, user_id, video_id, started_at, ended_at, active_seconds |
| `daily_stats` | user_id, date, minutes, videos_done, quizzes_taken |
| `goals` | id, user_id, type (`minutes`/`videos`/`quizzes`), target, active |
| `streaks` | user_id, current, longest, last_active_date, freezes_left |
| `notifications` | id, user_id, type, payload JSONB, read_at, created_at |
| `notification_prefs` | user_id, channel (`in_app`/`email`/`push`), type, enabled, quiet_start, quiet_end |
| `push_subscriptions` | id, user_id, endpoint, keys JSONB |
| `share_links` | id, token (random), resource_type, resource_id, owner_id, expires_at, revoked_at |
| `jobs` | id, user_id, video_id, kind, status, progress, error, attempts, cost_usd, started_at, finished_at |
| `usage_counters` | key (user_id or ip hash), period, kind, count (used for the abuse limits in section 8) |

RLS rules:
- Users can read and write only their own rows (`user_id = auth.uid()`).
- Shared tables (`videos`, `transcripts`, `summaries`, `flashcards`, `quizzes`, `mindmaps`) are readable if the user has a `user_videos` row for that video. Writes only by the service role.
- `share_links` tokens are checked by the API, never through direct table reads.
- Storage buckets are private; files are served with short-lived signed URLs.

Indexes: every foreign key, plus `(user_id, created_at)` on `study_sessions`, `notifications`, `jobs`, and a unique index on `videos(youtube_id)`.

---

## 6. API surface (FastAPI)

All routes need a Supabase JWT (anonymous users have one too).

| Area | Endpoints |
|---|---|
| Ingest | `POST /videos` (url), `POST /videos/upload`, `GET /videos/{id}`, `DELETE /videos/{id}` |
| Outputs | `GET /videos/{id}/summary`, `/transcript`, `/flashcards`, `/quiz`, `/mindmap`, `/slides` (create the job on first call, return status or data) |
| Edit | `PUT /videos/{id}/summary`, `POST /videos/{id}/summary/reset`, `GET /videos/{id}/summary/versions`, `PUT /videos/{id}/slides` |
| Export | `POST /videos/{id}/export/{pdf|md|pptx}` , `POST /videos/{id}/export/drive` |
| Quiz | `POST /quizzes/{id}/attempts` |
| Notes | `GET/PUT /videos/{id}/notes`, `POST /videos/{id}/note-files`, `GET /note-files/{id}` |
| Playlists | `POST /playlists`, `POST /playlists/import-youtube`, `PATCH /playlists/{id}/items/{item}/move`, `DELETE ...` |
| Study | `POST /study/sessions`, `POST /study/sessions/{id}/heartbeat`, `POST /study/sessions/{id}/end`, `GET /study/stats`, `GET/PUT /study/goals` |
| Notifications | `GET /notifications`, `POST /notifications/{id}/read`, `PUT /notification-prefs`, `POST /push/subscribe` |
| Sharing | `POST /share-links`, `DELETE /share-links/{id}`, `GET /public/{token}` |
| Limits | `GET /me/usage` (videos used today, remaining, and when the count resets) |

Standard error shape `{code, message}`. Pagination on every list.

---

## 7. How the main features work

- **Video player:** YouTube IFrame Player API for YouTube; Plyr for uploaded files. Save `progress_seconds` every 10 seconds and on pause.
- **Study timer and sessions:** the client starts a session when the user opens a video. A heartbeat every 20 seconds adds active time. Only count when the tab is visible and the video is playing or notes are being edited; stop after 2 minutes idle.
- **Streaks:** a day counts when `daily_stats.minutes` reaches a minimum (default 10). Calculated by a nightly job in each user's timezone, plus an instant update when the goal is hit. One streak freeze per week.
- **Daily goals:** minutes, videos finished, or quizzes taken. Progress comes from `daily_stats`. Hitting a goal creates a notification.
- **Playlists:** import with the YouTube Data API, or create your own. Reordering uses `dnd-kit` and a fractional position string, so a move updates one row.
- **Mind map:** the LLM returns a nested JSON outline, rendered with `markmap`. The user can export it as an image or Markdown.
- **Editable summary:** Tiptap over markdown, autosave every 3 seconds, version history, "reset to AI version".
- **Editable slides:** slides are JSON (title, bullets, layout, notes). A form-based editor plus live preview; export to PPTX/PDF from the JSON.
- **Notes upload:** a worker extracts text (`pypdf`, `python-docx`, `python-pptx`, plain text, OCR for images). The text can be added as extra context when generating summary, quiz or flashcards. Limits on size, type allow-list, and a malware scan.
- **Notifications:** an in-app bell first. Then email through Resend and browser push (VAPID). A scheduler job sends study reminders and "goal reached / streak at risk" messages, respecting quiet hours and per-type settings.
- **Sharing:** WhatsApp uses a `wa.me` link to a public share page. Drive export uses Google Drive `drive.file` scope. Share links are random tokens that can be revoked.
- **Code sandbox (later, after launch):** Monaco beside the player. JavaScript runs in the browser (Sandpack). Other languages run through Judge0 or Piston on an isolated server with CPU, memory and time limits, never on the API server. Nothing for it is built now, but keep the video page layout able to hold a second panel.

---

## 8. Usage limits and cost control

**Main limit: 10 videos per user per day.** There are no paid plans for now.

How it works:
- Every video a user adds today counts, whether from a link or an upload. Deleting a video does **not** refund the slot.
- Videos already in the shared cache still count, even though they cost almost nothing to serve.
- The day resets at midnight in the user's own timezone (`profiles.timezone`). Guests with no timezone yet use UTC, or the browser's timezone sent with the first request.
- The count is checked in the API before a job is created. At the limit it returns a clear message: "You have used 10 of 10 videos today. Resets at 12:00 AM."
- The limit lives in `profiles.daily_video_limit` (default 10), so you can change it for one user or for everyone without code changes.
- Counts come from the `jobs` table (videos created since the start of the user's day), so there is no separate counter to keep in sync or reset.
- The UI shows "7 of 10 videos today" and disables the input at 10, with a countdown to the reset.

Other limits (starting points, in one config file):

| | Guest | Signed-in |
|---|---|---|
| Videos per day | 10 | 10 |
| Max video length | 30 min | 90 min |
| Result retention | kept, same as signed-in | kept |
| PPTX watermark | no | no |
| Editing, playlists, study tools | no | yes |

Guests are anonymous Supabase users with their own id, so they get the same 10-per-day limit. When a guest signs in with Google the id is kept, so today's count carries over and signing in does **not** give extra videos that day.

Cost controls:
1. Shared cache by `youtube_id` / file hash.
2. Lazy generation per tab.
3. Cheaper models for flashcards, quiz and mind map; the stronger model for the main summary only.
4. Map-reduce for long transcripts (fixes the audit's long-video problem).
5. Abuse protection: Cloudflare Turnstile on guest ingest, and `usage_counters` for requests per minute per IP. Clearing cookies creates a new anonymous user with a fresh 10, so the per-user limit alone cannot stop determined abuse. Add a per-IP daily cap (for example 30 videos a day per IP) and Turnstile to cover that.
6. A daily global spend cap that stops new generation when reached.
7. `jobs.cost_usd` recorded for every job.

---

## 9. Security and production checklist

Do before any public launch:

- Fix every high item in [AUDIT_REPORT.md](AUDIT_REPORT.md): sanitize all rendered HTML (DOMPurify, KaTeX `trust: false`), safe upload names and size caps, API keys in headers (never in URLs), non-blocking endpoints, per-job file paths.
- Explicit CORS origins (no `*` with credentials).
- Service-role key only on the backend; never shipped to the browser.
- RLS tests: a test that user A cannot read user B's rows.
- Secrets in the host's secret manager; rotate the current keys.
- Security headers and CSP; dependency scanning in CI; update `next` (audit found a high issue).
- Supabase: daily backups plus point-in-time recovery on the paid plan; test one restore.
- Observability: Sentry, structured logs with job ids, a dashboard for job success rate, queue depth, cost per video.
- Terms of service, privacy policy, account deletion and data export (your legal check covers the content; these cover user data).
- Tests: unit tests for pure logic, API tests against a real Postgres (Supabase CLI local stack), a few Playwright end-to-end flows. CI runs lint, types, tests and build on every pull request.
- Environments: `local` (Supabase CLI + Docker Compose), `staging`, `production`, each with its own Supabase project.

---

## 10. Roadmap

Assumes about 3 developers. Total: **about 4.5 months** to a public launch (no payments, no sandbox). Phases 0 to 4 are built and tested on your local PC. The move to a cloud GPU happens in Phase 5.

### Phase 0: Stabilize (2 weeks)
- Apply the audit's high-severity fixes.
- Delete dead commented-out code and the legacy `static/` UI. Pin dependencies. Add Docker Compose and CI.
- Unit tests for URL validation, JSON parsing, summary cleanup, slide sanitizing.
- **Done when:** the current app is safe and tested, CI is green.

### Phase 1: Foundation (4 weeks)
- Create Supabase projects (staging, production); first migrations; RLS; Storage buckets.
- Restructure backend into feature modules; JWT verification.
- Guest = anonymous sign-in; Google login with `linkIdentity` upgrade.
- Postgres job queue and workers; Realtime progress in the UI.
- Shared cache, usage limits, Turnstile.
- Map-reduce for long transcripts; provider interface with fallback.
- **Done when:** guest and signed-in users run the current flow end to end, with results stored in Supabase.

### Phase 2: Video workspace (4 weeks)
- Video page: player, summary, transcript, flashcards, quiz, slides, **mind map** (new).
- Lazy generation per tab; library page (simple list, no search).
- Export PDF / Markdown / PPTX; share links; WhatsApp share.
- **Done when:** every output is available from one page for any user.

### Phase 3: Study tools (4 weeks)
- Sessions, timer and heartbeats; daily stats; streaks; daily goals.
- Playlists: YouTube import, custom, drag reorder, per-video progress.
- Typed notes.
- Notifications: in-app, email, web push, settings.
- **Done when:** a user can build a playlist, study with the timer and keep a streak.

### Phase 4: Editing and uploads (3 weeks)
- Editable summary with versions.
- Editable slides with export.
- Notes upload with text extraction, usable as generation context.
- Google Drive export.
- **Done when:** users can edit AI outputs and bring their own material.

### Phase 5: Cloud deployment and launch (3 weeks)
- Benchmark Whisper `small` vs `large-v3` on your own videos; pick the model and GPU (section 3.1).
- Set up staging and production: Supabase projects, API/CPU worker host, GPU worker, secrets, domain, HTTPS.
- Load test with the daily limit in mind (for example 50 users each submitting 10 videos at once); tune worker counts and queue timeouts.
- Cost dashboard and alerts; usage display showing "x of 10 videos today".
- Landing page, onboarding, analytics funnel, public share pages.
- **Done when:** the app runs on the cloud, a real user can sign in with Google and use all features, and you know the cost per user.

### Later (after launch, not scheduled)
- **Code sandbox:** side-by-side player and editor; Sandpack; Judge0/Piston in isolation.
- **Payment gateway and paid plans:** Razorpay and/or Stripe, plan tiers, higher limits.

---

## 11. Scaling path

| Stage | Users | What changes |
|---|---|---|
| Launch | up to ~1k | One API container, one worker of each kind, Supabase Pro plan. |
| Growth | ~1k to 50k | 2+ API instances, autoscaled workers, Supabase connection pooler (Supavisor), read replica for stats, add Redis if rate limiting or queue load needs it. |
| Scale | 50k+ | Partition `study_sessions` by month, dedicated GPU pool, move heavy exports to their own service, consider a larger Supabase compute add-on. |

---

## 12. Metrics

- Guest to finished summary rate; guest to sign-up rate.
- Videos per active user; study minutes per week; streak of 3+ days.
- Job success rate and time to first summary (target under 60 s for captioned videos).
- AI cost per video and per active user.
- How many users hit the daily limit, and the average videos per active user per day (tells you when to change it or add paid plans).

---

## 13. Open items for you

1. Should a failed job refund its slot? Suggested: yes, if it failed on our side.
2. Which cloud for the deployed server: AWS, GCP, or a GPU-focused provider (RunPod, Lambda, Modal)? A benchmark in Phase 5 will settle the GPU size.
3. Does your current PC have an NVIDIA GPU? This decides whether you test Whisper `large-v3` locally.
4. Confirm the max video length (30 minutes for guests, 90 for signed-in) or give your own numbers.

Decided: guests and signed-in users both get 10 videos per day. Signing in is encouraged by the study tools, editing, playlists and saved history, not by a higher limit.
