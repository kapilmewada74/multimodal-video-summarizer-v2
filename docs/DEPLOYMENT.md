# Deployment guide (Phase 5)

How to run SUMMARIZE.AI in the cloud: what runs where, how it is built and released, what you must do yourself,
and how to check it works. Everything in this repository that can be prepared in advance has been; the rest is
accounts, money and DNS, which only the owner can do (section 3).

## 1. Architecture

```
 Browser ──HTTPS──> Caddy (auto TLS) ──/api/*──> API  (FastAPI, stateless, 1..n copies)
                         │                          │
                         └──everything else──> Web  (Next.js)
                                                    │
        Workers (CPU, 1..n)  ──┐                    ▼
        GPU workers (0..n)   ──┼──────────> Supabase: Postgres (job queue, data), Auth, Storage
        (pull jobs, no inbound traffic)
```

* **API, web, workers are separate containers** and only talk through Supabase. That is what lets you scale each alone.
* **The queue is Postgres** (`FOR UPDATE SKIP LOCKED`): any number of workers, anywhere, take jobs safely. Workers need no open ports,
  so a GPU machine behind NAT, or one rented by the hour, works.
* **Files** go through Supabase Storage (`FILE_STORE=supabase`), so API and workers can run on different machines.
* **No state in the API process** (signed links use a shared key), so a second API copy only needs `docker compose up --scale api=2`.
* **Staging and production are two separate Supabase projects** with the same migrations, and two servers (or one small one for staging).

## 2. What is already in the repository

| Area | Where |
|---|---|
| Images: API/CPU worker, GPU worker, web | `Dockerfile`, `Dockerfile.gpu`, `frontend/Dockerfile` (non-root, health checks, clean shutdown) |
| Production stack with HTTPS | `docker-compose.prod.yml`, `deploy/Caddyfile`, `.env.production.example` |
| CI, image publishing, deploy, dependency updates | `.github/workflows/ci.yml`, `release.yml`, `deploy.yml`, `.github/dependabot.yml` |
| Refuses unsafe production config | `backend/summarizer/core/startup_checks.py` |
| Logs, request ids, security headers, Sentry | `backend/summarizer/core/observability.py` |
| Probes: `/api/health/live`, `/api/health/ready`; ops numbers: `/api/internal/stats` | `main.py`, `features/ops/` |
| Right to a copy and to erasure | `/api/me/export`, `DELETE /api/me`, Settings > Your data |
| Privacy Policy, Terms, robots, sitemap, social previews | `frontend/src/app/privacy`, `terms`, `robots.ts`, `sitemap.ts` |
| Whisper model/GPU benchmark | `scripts/benchmark_whisper.py` |
| Load test (queue and HTTP) | `scripts/load_test.py` |
| Cost per video and per user | `scripts/cost_model.py` |
| Live checks of a Supabase project | `scripts/check_supabase.py`, `scripts/live_smoke.py` |

## 3. Who does what

**Only you can do** (accounts, payment, identity):

1. Create the **production Supabase project** (and a staging one). Run `supabase db push` or the Deploy workflow. Re-run `python3 scripts/check_supabase.py` against each.
2. Buy a **domain**; point DNS at the server (an `A` record for `app.yourdomain.com`).
3. Rent the **server** (CPU: 4 vCPU / 8 GB is a good start) and, if the benchmark says so, a **GPU** machine. Install Docker (and the NVIDIA Container Toolkit on the GPU one).
4. **Google Cloud:** add the production domain as an authorized JS origin, add the production Supabase callback, and **publish** the OAuth consent screen (Testing mode limits you to 100 listed test users and tokens expire after 7 days).
5. **Supabase Auth:** set Site URL and Redirect URLs to the production domain; turn on **Custom SMTP** (the built-in sender is limited to a few emails per hour and is not for production); Pro plan for daily backups/PITR.
6. Create the **GitHub environments** `staging` and `production` with the secrets and variables in section 5; enable branch protection on `main`.
7. Create accounts for **Resend** (email), **Sentry** (errors), an **uptime monitor** (e.g. UptimeRobot/Better Stack), and optionally **Plausible**.
8. Rotate any key that has ever appeared in a chat, screenshot or log. Put real keys only in `.env.production` on the server / GitHub secrets.
9. Have the **Privacy Policy and Terms reviewed** by someone qualified for your country; fill `NEXT_PUBLIC_OPERATOR_NAME` and `NEXT_PUBLIC_CONTACT_EMAIL`.
10. Run the benchmark with **your own videos** on the **real hardware**, then set `WHISPER_MODEL`.

**Already done / can be done by Claude** (in this repository): everything in section 2, the tests for it, and updating these files when you
tell me the real numbers (benchmark results, prices, worker counts) or a provider choice.

## 4. Step by step

### 4.1 Staging first
1. Create the staging Supabase project; `supabase link --project-ref <ref>` then `supabase db push`.
2. `python3 scripts/check_supabase.py` (point `.env` at staging) must end with "Everything needed is connected."
3. On the staging server: copy `docker-compose.prod.yml`, `deploy/Caddyfile`; create `.env.production` from `.env.production.example`.
   Generate secrets: `openssl rand -hex 32` for `STREAM_SIGNING_KEY`, `IP_HASH_SALT`, `OPS_TOKEN`.
4. Log in to the registry once: `echo $PAT | docker login ghcr.io -u <user> --password-stdin` (a token with `read:packages`).
5. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d`. If the API exits, `docker compose logs api` lists **exactly which settings are unsafe or missing**.
6. Open the site, sign in with Google, summarize a captioned video, an uploaded video and a video without captions; use every tab; export; delete a test account.

### 4.2 Releasing
* Merge to `main` -> **CI** (tests, lint, image build, compose validation) -> **Release images** publishes `api`, `gpu-worker`, `web` to GHCR tagged with the commit.
* **Deploy** (manual, Actions tab): choose environment + image tag; it applies migrations, updates the server, and waits for `/api/health/ready`.
* **Rollback:** run Deploy again with the previous tag. Migrations are additive; never edit one that has shipped, add a new one.
* Frontend build variables (`NEXT_PUBLIC_*`) come from GitHub **Variables** (they are public): `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_ANALYTICS_DOMAIN`.
  One web image per environment is built from the variables of the environment that triggers it; if staging and production need different values, build per environment.

### 4.3 GPU worker
```bash
docker run -d --name gpu-worker --restart unless-stopped --gpus all \
  --env-file .env.production -e WHISPER_MODEL=large-v3 \
  -v whisper-models:/home/appuser/.cache \
  ghcr.io/rahuldhakad01/multimodal-video-summarizer/gpu-worker:<tag>
```
It needs only outbound access to Supabase and the AI providers. Scale by starting more of them.

### 4.4 Picking the Whisper model and the GPU
```bash
python3 scripts/benchmark_whisper.py lecture.mp4 talk.mp3 --reference talk.txt --models small,medium,large-v3
```
Run it on the machine you are considering. Take the RTF of the recommended model, put it in `scripts/cost_model.py` (`--rtf`),
and set `WHISPER_MODEL`. Most YouTube videos have captions and never reach Whisper (uploads and caption-less videos do).

### 4.5 Sizing workers
```bash
python3 scripts/load_test.py --users 50 --videos-each 10 --workers 8 --job-seconds 90
```
`--job-seconds` is your measured time per video. The last line says how many workers keep the longest wait under your target. Re-run with `--http https://staging... --token ...` to load the API itself.
Never point `--database-url` at production.

### 4.6 Cost
```bash
python3 scripts/cost_model.py --active-users 1000 --gpu-hourly 0.7 --rtf 0.05
```
Replace every assumption with a real number. `GET /api/internal/stats` gives the real daily counts (completed, failed, active users, processing time) to feed it.

## 5. Secrets and variables

| Where | Name | Notes |
|---|---|---|
| GitHub environment **secret** | `SUPABASE_ACCESS_TOKEN` | personal access token, for migrations |
| | `SUPABASE_DB_PASSWORD` | database password of that project |
| | `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER` | server access for the Deploy workflow |
| GitHub environment **variable** | `SUPABASE_PROJECT_REF`, `SITE_URL` | `SITE_URL` e.g. `https://app.example.com` |
| GitHub **variables** (public) | `NEXT_PUBLIC_*` | compiled into the web image |
| Server `.env.production` | see `.env.production.example` | never in git |

## 6. Security checklist before launch
- [ ] `/api/health/ready` is the only probe exposed; `/api/internal/stats` needs `OPS_TOKEN`.
- [ ] Supabase: RLS on every table (checker), storage bucket private, anonymous sign-ins **on** (free try-out; a Turnstile captcha is a planned addition), manual linking **on**, email confirmations **on**, custom SMTP set.
- [ ] Service-role key only on the server (never in the web image or a `NEXT_PUBLIC_` variable).
- [ ] Google consent screen published; redirect URLs list only production (and staging) domains.
- [ ] Firewall: only 80/443 (and SSH from your IP) open on the server.
- [ ] Backups: Supabase Pro daily backups on; do one test restore.
- [ ] Error monitoring and uptime alerts delivering to a phone you read.
- [ ] Privacy Policy / Terms reviewed; contact address works.
- [ ] Load test passed at the user count you expect in week one.


## Link previews (WhatsApp, Telegram, X, LinkedIn, Slack)

A shared summary (`/s/<token>`) and the site itself carry preview cards: the title, a short description and a 1200x630
picture in our theme (video thumbnail, flashcard count). They are made by the web app (`opengraph-image.tsx`).

- Set `NEXT_PUBLIC_APP_URL` to the public address of the site **before building**. The card address is built from it; if it
  is missing, apps are told to fetch the picture from `localhost` and show no preview.
- The web server must be able to reach the API (`BACKEND_API_URL`) to read a shared summary.
- Titles in non-Latin scripts (for example Hindi) keep their real title in the preview text, but the card picture shows
  "Shared study notes", because the built-in image font cannot draw those letters. Loading a font would fix it.
- Apps cache previews. After changing a card, re-scrape it with Facebook's Sharing Debugger (also used by WhatsApp),
  LinkedIn's Post Inspector or Telegram's `@WebpageBot`.
