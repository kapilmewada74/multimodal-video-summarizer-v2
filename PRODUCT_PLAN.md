# Product & Architecture Plan: from prototype to a market-ready study platform

Written 2026-11-10. Builds on [AUDIT_REPORT.md](AUDIT_REPORT.md). Assumes a small team (2 to 4 developers) and a budget-conscious launch.

---

## 1. Vision in one paragraph

Today: paste a YouTube link or upload a file, get a summary, transcript, flashcards, slides and a quiz.
Target: **a study workspace built around each video.** Every video gets one page with the player, summary, transcript, flashcards, mind map, slides, quiz, notes and (later) a code panel. Videos live in playlists, progress is tracked with timers, streaks and daily goals.

Two ways in:
- **Guest (no login):** paste a link or upload a file and get the core outputs for free, with limits. Nothing is saved beyond that browser session.
- **Signed-in:** everything is saved and unlocked: playlists, editing, notes upload, streaks, goals, notifications, sharing, history across devices.

The guest tier is your growth funnel. The signed-in tier is your retention and revenue.

---

## 2. Key decisions (the short answers)

| Question | Recommendation | Why |
|---|---|---|
| Architecture | **Modular monolith** (feature-based), plus separate background workers | Microservices would slow a small team down. Feature folders let you split later. |
| Main database | **PostgreSQL** (managed: Neon, Supabase or AWS RDS) | Relational data (users, playlists, videos, progress) plus JSONB for flexible AI output. |
| Vector search | **pgvector** inside the same Postgres | Needed for chat-with-video later. No second database to run. |
| Cache, queue, rate limits | **Redis** (Upstash or ElastiCache) | Job queue, rate limiting, live progress, session cache. |
| Files | **S3-compatible object storage** (Cloudflare R2 is cheapest) | Uploads, notes files, exported PPTX, thumbnails. |
| Background jobs | **Dramatiq or ARQ** workers (Celery if you want maturity) | Removes the thread-per-request design. Retries, timeouts, scaling. |
| Speech-to-text | Separate **GPU worker pool** (Modal, RunPod) or a hosted API | GPU cost only when jobs run. Keep it off the web server. |
| Auth | **Clerk, Auth.js or Supabase Auth**; Google login first | Do not build password login yourself. |
| Realtime progress | **Server-Sent Events** (SSE) | Replaces the 600 ms polling. |
| Frontend | Keep **Next.js 15 + Tailwind**, reorganize into feature folders | Already built. Retire the legacy `static/` UI. |
| Payments | **Razorpay** (India) and/or **Stripe** (global) | Add at Phase 5, not earlier. |

---

## 3. Biggest risks to settle before building

Fix these first. They can end the business.

1. **YouTube terms of service.** Downloading video with `yt-dlp` and scraping captions is against YouTube's terms and breaks often. For a public product:
   - Use the official **YouTube Data API** for metadata and playlists.
   - Play videos only through the **official IFrame player**. Never re-host or download them for users.
   - Treat caption fetching as fragile. Cache aggressively, and always have the upload path as the reliable route.
   - Get legal advice before launch. This is not optional.
2. **Copyright on uploads.** Users upload content they may not own. You need terms of service, a takedown process, and per-user storage with deletion.
3. **AI cost per video.** One summary is cheap. Flashcards + slides + quiz + mind map for every video is not, once free users arrive. See section 9.
4. **Privacy law.** India's DPDP Act (and GDPR if you serve the EU): privacy policy, consent, data export and delete.
5. **The current code's security gaps** (audit H-1 to H-7) must be closed before any public launch.

---

## 4. Feature set

### 4.1 Free (guest, no login)

- Paste a YouTube link or upload one file and get summary, transcript, flashcards, quiz, slides and mind map.
- Copy, download as PDF/Markdown, download PPTX.
- Share through WhatsApp (link) and "copy link".
- Limits: a few videos per day per IP/device, shorter maximum duration, watermark on PPTX, results kept 24 hours.

### 4.2 Signed-in (free account)

- Saved library, history across devices, per-video workspace page.
- Video player with synced transcript (click a line to jump).
- Notes (written and uploaded), editable summary, editable slides.
- Playlists with reordering, progress per video.
- Study timer, sessions, streaks, daily goals.
- Notifications (study reminders, "your summary is ready").
- Export to Google Drive, share links.
- Higher limits.

### 4.3 Pro (paid, later)

- Longer videos, more videos per month, faster queue.
- Spaced-repetition flashcards, chat with video, Anki/Notion export.
- No watermark, custom slide themes.
- Code sandbox side-by-side.
- Team/classroom sharing.

### 4.4 Feature details and how to build each

| Feature | Approach | Notes |
|---|---|---|
| **Video player** | YouTube IFrame Player API for YouTube; Plyr or Video.js for uploads | Report `currentTime` every few seconds for progress and for transcript highlight. |
| **Transcript sync** | Store transcript as timed segments (`start`, `end`, `text`), not one text blob | Required for click-to-seek, chapters and "chat with timestamps". Whisper and caption APIs both return times, so keep them. |
| **Timer / sessions** | Client timer + server heartbeat every 15 to 30 s: `session_id`, `video_id`, `seconds_active` | Count only when the tab is visible and the video is playing or notes are being edited. Idle after 2 min. Anti-cheating is not needed. |
| **Streaks** | Computed on the server from sessions, in the **user's timezone** | A day counts when study time >= daily minimum (e.g. 10 min). Allow one "freeze". Store `user_daily_stats` rows rather than recomputing. |
| **Daily goals** | Goal types: minutes studied, videos finished, flashcards reviewed | Table `goals`; progress read from `user_daily_stats`. |
| **Playlists** | Import a YouTube playlist (Data API) or build your own | Items hold position, status (not started / in progress / done). |
| **Arranging videos** | Drag-and-drop with `dnd-kit`; store position as a fractional index (LexoRank style) | Reordering one item updates one row, not the whole list. |
| **Per-video feature set** | One `VideoWorkspace` page, tabs for each output | Each output is generated lazily on first open, then cached in the DB. Do not generate all of them upfront. |
| **Mind map** | LLM returns a nested JSON outline; render with `markmap` (fastest) or React Flow (editable) | Start with markmap. Store the outline as JSON, so it can be edited later. |
| **Summary editing** | Rich-text editor (Tiptap) over markdown | Autosave every few seconds, keep `ai_version` and `user_version` separately with a "reset to AI" button. Versions table for undo. |
| **Editable slides** | Store slides as **JSON** (title, bullets, layout, notes, image). Edit in the browser, export to PPTX from the JSON | Do not edit PPTX files directly. A simple form-based editor first; a canvas editor (Konva/Fabric) only if users ask. |
| **Notes (typed)** | Tiptap editor, one notes doc per video, timestamp links (`@12:34`) | Insert-timestamp button while the video plays is the killer feature. |
| **Notes upload (many formats)** | PDF, DOCX, PPTX, TXT, MD, images (OCR), audio | Extract text in a worker: `pypdf` / `pdfplumber`, `mammoth` or `python-docx`, `python-pptx`, Tesseract or a cloud OCR for images. Treat uploaded notes as extra context for summary/quiz/chat. Scan every upload for size, type and malware. |
| **Notifications** | In-app (bell) first. Then email (Resend/SES). Then web push (VAPID). WhatsApp later | Use a `notifications` table plus a scheduler (cron worker). Respect timezone and quiet hours. Every type needs an on/off setting. |
| **Sharing** | WhatsApp: a `wa.me/?text=` link (no API needed). Drive: Google Drive API with the narrow `drive.file` scope. Public read-only link with a random token | Share links must never expose the owner's other data. Let users revoke. |
| **Code sandbox (later)** | Monaco editor beside the player. Run JS in the browser with Sandpack. Run Python/C++/Java through **Judge0** or **Piston**, self-hosted and isolated | This is the riskiest feature (arbitrary code execution). Ship it last. Never run user code on your API servers. |

---

## 5. Architecture

### 5.1 System diagram

```
Browser (Next.js, PWA)
   |  HTTPS / SSE
   v
CDN (Cloudflare) --> Next.js frontend (Vercel or container)
   |
   v
API (FastAPI modular monolith, stateless, 2+ instances)
   |------------------> PostgreSQL (+ pgvector)
   |------------------> Redis (cache, rate limit, queue, pub/sub)
   |------------------> Object storage (R2/S3)
   |
   v  enqueue
Job queue (Redis)
   |
   +--> CPU workers: yt metadata, captions, ffmpeg, text extraction, PPTX export
   +--> GPU workers: Whisper transcription (autoscaled, scale to zero)
   +--> LLM workers: summary, flashcards, quiz, mind map, slides (rate-limited calls to Groq/Gemini/etc.)
   |
   v
Notifications / scheduler worker --> email, web push

External: YouTube Data API, Groq / Gemini / xAI, Google Drive API, Razorpay/Stripe
```

### 5.2 Why a modular monolith

- One deployable, one database, one codebase. Fast to build and debug.
- Strict boundaries between feature modules (they talk through service interfaces, not each other's tables).
- When one part needs separate scaling (transcription, sandbox), it is already a worker or can be lifted out.

### 5.3 Feature-based folder layout

**Backend**

```
backend/
  app/
    main.py                 # app factory, router registration
    core/                   # config, db, redis, security, logging, errors
    shared/                 # base models, pagination, storage client, llm client
    features/
      auth/                 # sessions, guest tokens, login callbacks
      users/                # profile, settings, preferences
      videos/               # video records, ingest (url/upload), status
      transcripts/          # timed segments, caption + whisper providers
      summaries/            # generation, edit, versions
      flashcards/           # generation, spaced repetition review
      quizzes/              # generation, attempts, scores
      mindmaps/
      slides/               # slide JSON, PPTX/PDF export
      notes/                # typed notes, uploaded files, extraction
      playlists/            # import, ordering, progress
      study/                # sessions, timer heartbeats, streaks, goals
      notifications/        # in-app, email, push, scheduler
      sharing/              # public links, WhatsApp, Drive
      billing/              # plans, usage limits, webhooks
      sandbox/              # (later) code execution client
    workers/                # queue tasks, one file per feature
    migrations/             # Alembic
  tests/                    # mirrors features/
```

Inside each feature: `router.py` (HTTP), `schemas.py` (Pydantic), `service.py` (business logic), `models.py` (SQLAlchemy), `tasks.py` (background jobs), `tests/`.

**Frontend**

```
frontend/src/
  app/                      # routes only (thin)
    (marketing)/            # landing, pricing
    (app)/library, video/[id], playlists, study, settings
  features/
    ingest/ video-player/ transcript/ summary/ flashcards/
    quiz/ mindmap/ slides/ notes/ playlists/ study-timer/
    streaks-goals/ notifications/ sharing/ auth/ billing/
  shared/ (ui, hooks, api client, utils)
```

Rule: a feature may import from `shared/`, never from another feature's internals.

### 5.4 Job pipeline (replaces threads and global files)

States: `queued -> fetching -> transcribing -> summarizing -> ready` (or `failed`).

1. API creates a `video` row and a `job` row, returns the ids immediately.
2. A worker takes the job, writes progress to Redis, and the API streams it to the browser over SSE.
3. Each stage stores its result in the database (transcript, summary) and files in object storage, using per-job paths.
4. Other outputs (flashcards, quiz, mind map, slides) are **separate jobs**, created on first request.
5. Jobs have timeouts, retries with backoff, and a dead-letter state.

**Dedupe by video:** key YouTube videos by `youtube_video_id` and uploads by file hash. If another user already processed that video, reuse the transcript and summary. This is the largest single cost saver.

### 5.5 Guest vs signed-in

- A guest gets a signed, httpOnly cookie that identifies an **anonymous user row** (`is_guest = true`). All the same tables work for guests.
- When a guest signs in, **merge** the anonymous user into the real account, so nothing they generated is lost. This turns the free tier into a signup path.
- Guests are throttled by IP + device cookie + a CAPTCHA (Turnstile) when abused.

---

## 6. Database design (PostgreSQL)

Core tables, simplified:

| Table | Key columns |
|---|---|
| `users` | id, email, name, timezone, is_guest, plan, created_at |
| `videos` | id, source (`youtube`/`upload`), youtube_id, file_key, title, duration, language, owner_id (nullable for shared cache), status |
| `transcripts` | id, video_id, language, provider, segments JSONB (`[{start,end,text}]`) |
| `summaries` | id, video_id, user_id (null = shared AI version), content_md, model, version, is_user_edited |
| `summary_versions` | id, summary_id, content_md, created_at |
| `flashcards` | id, video_id, front, back, tag; `flashcard_reviews`: user_id, card_id, due_at, interval, ease/stability (FSRS) |
| `quizzes`, `quiz_questions`, `quiz_attempts` | questions JSONB, answers, score, difficulty |
| `mindmaps` | id, video_id, outline JSONB |
| `slide_decks` | id, video_id, user_id, slides JSONB, template, updated_at |
| `notes` | id, user_id, video_id, content JSON, updated_at |
| `note_files` | id, user_id, video_id, file_key, mime, extracted_text, status |
| `playlists` | id, user_id, title, source (`youtube`/`custom`), source_id |
| `playlist_items` | playlist_id, video_id, position (string, fractional), status, progress_seconds |
| `study_sessions` | id, user_id, video_id, started_at, ended_at, active_seconds |
| `user_daily_stats` | user_id, date, minutes, videos_done, cards_reviewed |
| `goals` | user_id, type, target, period |
| `streaks` | user_id, current, longest, last_active_date, freezes_left |
| `notifications` | id, user_id, type, payload, read_at, sent_at, channel |
| `notification_prefs` | user_id, channel, type, enabled, quiet_hours |
| `share_links` | id, token, resource_type, resource_id, owner_id, expires_at, revoked_at |
| `jobs` | id, video_id, kind, status, error, attempts, timings |
| `usage_counters` | user_id/ip, period, kind, count (for limits and billing) |
| `chunks` (later) | video_id, text, embedding vector, start, end (for chat with video) |

Notes:
- Use **UUIDv7** or ULID ids (sortable, not guessable).
- Put an index on every foreign key and on `(user_id, created_at)`.
- Store AI outputs as JSONB, but keep fields you query (status, duration, owner) as real columns.
- Row-level ownership checks in the service layer on every query. Add Postgres RLS if you use Supabase.
- Migrations with **Alembic** only. No manual schema edits.
- Backups: daily snapshots + point-in-time recovery. Test a restore.

**Why not MongoDB or Firebase?** Your data is relational (users -> videos -> playlists -> progress), you need joins, aggregates (streaks, stats) and transactions. Postgres with JSONB handles the document-like parts.

---

## 7. Scaling roadmap

| Stage | Users | Setup |
|---|---|---|
| **A. Launch** | up to ~1k | 1 API container, 1 worker, Neon/Supabase Postgres, Upstash Redis, R2, Whisper via hosted API or Modal on demand. Monthly cost: low tens of dollars plus AI usage. |
| **B. Growth** | ~1k to 50k | 2+ API instances behind a load balancer, autoscaled workers per queue, read replica for stats, CDN caching of public share pages, global transcript/summary cache, PgBouncer connection pooling. |
| **C. Scale** | 50k+ | Split heavy workers into their own services, partition `study_sessions` by month, move search to a dedicated engine if needed, multi-region read, dedicated GPU pool or a cheaper batch ASR, enterprise/classroom features. |

Principles that make scaling cheap later:
- **Stateless API** (no in-memory jobs, no local files).
- **Everything slow is a queued job.**
- **Cache by content**, not by user.
- **Rate-limit and budget** every external API (LLM, YouTube, Whisper).
- Move to Kubernetes only when you truly need it. Managed containers (Fly, Railway, Render, Cloud Run) are enough for stages A and B.

---

## 8. Production readiness checklist

**Security**
- Close every item from the audit (XSS sanitizing, upload filename + size limits, key handling, CORS, auth, rate limits).
- Validate and re-encode uploads; scan for malware; private buckets with signed URLs.
- Secrets in a secret manager, never in `.env` on servers. Rotate the current keys.
- CSRF protection with cookie auth, strict CSP, security headers.
- Dependency scanning (Dependabot, `pip-audit`, `npm audit`) in CI.

**Reliability**
- Health and readiness endpoints; graceful shutdown; retries with backoff; circuit breaker around each AI provider with automatic fallback between providers.
- Idempotent jobs (safe to run twice).
- Dead-letter queue and an admin page to retry jobs.

**Observability**
- Structured JSON logs with request and job ids.
- Sentry for errors (frontend + backend), OpenTelemetry traces, Prometheus/Grafana or a hosted equivalent.
- Dashboards: job success rate and duration per stage, queue depth, AI cost per video, p95 latency.
- Alerts: failed-job rate, queue backlog, cost spike, DB connections.

**Quality**
- Tests: unit tests for pure logic, API tests with a real Postgres in Docker, frontend component tests, a few Playwright end-to-end flows (guest summarize, sign in, playlist, edit slide).
- CI on every PR: lint, type check, tests, security scan, build. CD with staging then production, and one-click rollback.
- Docker for everything; one `docker compose up` for local development.

**Product / legal**
- Terms, privacy policy, cookie consent, data export and account deletion.
- Abuse reporting and takedown flow.
- Accessibility (WCAG AA), keyboard shortcuts for the player, mobile-first layout, PWA install.
- Analytics (PostHog) with a clear funnel: guest summary -> sign up -> second video -> streak day 3 -> upgrade.

---

## 9. AI cost control (this decides whether you profit)

1. **Cache by content:** same video = same transcript/summary for everyone.
2. **Lazy generation:** build flashcards, quiz, mind map and slides only when a user opens that tab.
3. **Right model for the job:** a small cheap model for flashcards/quiz/mind map, a better one for the main summary.
4. **Chunk long transcripts** (map-reduce) so you do not pay to resend everything.
5. **Hard limits per tier** (videos/day, max duration, regenerations) stored in `usage_counters`.
6. **Budget guard:** a global daily spend cap that degrades free-tier features first.
7. **Track cost per video** in the `jobs` table from day one.

---

## 10. Extra features: add these

Priority by value for a study product:

| Feature | Why | When |
|---|---|---|
| **Click-to-seek transcript and auto chapters** | Makes the player useful on its own | Phase 2 |
| **Chat with the video** (RAG with timestamps, via pgvector) | The most-requested AI study feature; strong Pro driver | Phase 4 |
| **Spaced repetition (FSRS) for flashcards** | Turns flashcards into a habit; drives retention | Phase 3 |
| **Notes with timestamp links** | Differentiator, cheap to build | Phase 3 |
| **Export: PDF, Markdown, Anki, Notion** | Users want their data out; cheap trust builder | Phase 2-4 |
| **Multi-language summary and transcript** | Fits your Hindi/Hinglish audience | Phase 2 |
| **PWA / installable + offline notes** | Mobile reach without native apps | Phase 3 |
| **Browser extension** ("Summarize this video" button on YouTube) | Strong acquisition channel | Phase 5 |
| **Search across your library** (Postgres full-text first) | Needed once users have 20+ videos | Phase 4 |
| **Weekly progress email** | Cheap retention | Phase 3 |
| **Classroom / teacher sharing** | Pays well, but only after the core is solid | Phase 6 |

## 11. Do NOT build (yet, or ever)

| Skip | Reason |
|---|---|
| **Microservices / Kubernetes on day 1** | Cost and complexity with no benefit at this size. |
| **Hosting or re-streaming videos yourself** | Copyright and bandwidth cost. Use the official YouTube player. |
| **Letting users download YouTube videos** | Legal risk and against YouTube's terms. |
| **Live-stream transcription** | Hard, expensive, small audience. |
| **Native iOS/Android apps first** | A PWA covers most of it. Revisit after traction. |
| **Social feed, comments, follower system** | Moderation burden and off-mission. A leaderboard is optional later. |
| **Training your own LLM or ASR model** | Use APIs and open models. |
| **Fancy gamification (coins, badges shop)** | Streaks and goals are enough. Do not build an economy. |
| **A full canvas slide designer** (like Canva) | Form-based slide editing covers 90% of needs. |
| **Many payment gateways** | One per region is enough. |
| **WhatsApp Business API automation in v1** | Needs approval and costs per message; a share link covers sharing. |
| **Code sandbox before the core is stable** | Highest security risk. Phase 6 only, and isolated. |

---

## 12. Execution plan (phases)

Rough durations assume 3 developers. Adjust for your team size.

### Phase 0: Stabilize the base (2 weeks)
- Fix the audit's high-severity items: HTML sanitizing, upload safety, key handling, non-blocking endpoints, per-job file paths.
- Delete dead code and the legacy `static/` UI. Pin dependencies. Add Docker + `docker compose`.
- Add unit tests for the pure functions and basic CI.
- Decide the YouTube legal approach (section 3).
- **Done when:** the current app works safely, with CI green.

### Phase 1: Foundation (4 weeks)
- Move to the feature-based backend layout. Add Postgres + Alembic, Redis, object storage.
- Replace threads with a worker queue; add SSE progress; store timed transcript segments.
- Guest sessions + sign-in (Google) + guest-to-account merge.
- Usage limits, rate limiting, global content cache.
- Observability basics (Sentry, structured logs).
- **Done when:** guest and signed-in users can run the existing flow, and results persist in Postgres.

### Phase 2: The per-video workspace (4 weeks)
- Video page with player, synced transcript, summary, flashcards, quiz, slides, **mind map** (new).
- Lazy generation of each output; library page; share link + WhatsApp share; PDF/Markdown export.
- **Done when:** one page shows every feature for a video, for any user.

### Phase 3: Study engagement (4 weeks)
- Study timer and sessions, daily stats, streaks, daily goals.
- Playlists (YouTube import, custom, drag-to-reorder, per-video progress).
- Typed notes with timestamp links. FSRS flashcard reviews.
- In-app notifications, email reminders, web push; notification settings.
- PWA install.
- **Done when:** a user can build a playlist, study it with the timer, and keep a streak.

### Phase 4: Editing and uploads (4 weeks)
- Editable summary (Tiptap, autosave, versions, reset to AI).
- Editable slides (JSON editor, themes, PPTX/PDF export).
- Notes upload with extraction for PDF/DOCX/PPTX/TXT/MD/images, used as context for outputs.
- Google Drive export. Library search. Chat with video (pgvector).
- **Done when:** users can edit and enrich AI outputs and bring their own material.

### Phase 5: Monetization and scale (3 to 4 weeks)
- Plans, billing (Razorpay/Stripe), usage dashboard, upgrade prompts.
- Autoscaling workers, read replica, caching of public pages, cost dashboards, load testing.
- Landing page, SEO pages for public shared summaries, onboarding, analytics funnels.
- Optional: browser extension.
- **Done when:** you can charge, and you know the cost per active user.

### Phase 6: Code sandbox and classroom (6+ weeks, optional)
- Side-by-side player + Monaco; Sandpack for JS; Judge0/Piston for other languages in an isolated network and with CPU/memory/time limits.
- Teacher/classroom sharing.

**Total to a paid public launch: about 5 to 6 months** with 3 developers (Phases 0 to 5).

---

## 13. Suggested tech stack (summary)

| Layer | Choice |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind, TanStack Query, dnd-kit, Tiptap, Monaco (later), markmap, Plyr / YouTube IFrame API |
| Backend | FastAPI, Pydantic, SQLAlchemy 2, Alembic |
| Workers | Dramatiq or ARQ (Redis), ffmpeg, faster-whisper on GPU |
| Data | PostgreSQL + pgvector, Redis, R2/S3 |
| AI | Provider abstraction layer over Groq / Gemini / xAI (swap and fallback in one place) |
| Auth | Clerk or Auth.js (Google), signed guest cookies |
| Infra | Docker, GitHub Actions, Vercel + Fly/Railway/Cloud Run, Cloudflare CDN/Turnstile |
| Observability | Sentry, OpenTelemetry, PostHog |
| Payments | Razorpay / Stripe |

---

## 14. Success metrics to track from day one

- Activation: % of guests who get a finished summary.
- Conversion: guest -> signed-up.
- Retention: users with a streak of 3+ days; week-4 retention.
- Engagement: outputs opened per video; study minutes per week.
- Quality: job success rate, time-to-first-summary (target: under 60 s for captioned videos).
- Economics: AI cost per video, cost per active user, free-to-paid conversion.

---

## 15. Decisions I need from you

1. **Legal approach for YouTube:** are you comfortable with an official-player-only design, and with seeking legal advice before launch?
2. **Hosting and budget:** managed platforms (Vercel/Fly/Neon) or a cloud account (AWS/GCP)? What monthly budget?
3. **Primary market:** India first (Razorpay, Hindi/Hinglish focus), or global?
4. **Team size and timeline:** this decides whether to compress the phases.
5. **Free-tier limits:** how many videos per day for guests and free accounts?
6. **Is the code sandbox core or a nice-to-have?** (It stays in Phase 6 unless you say it is core.)
