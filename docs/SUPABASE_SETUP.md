# Supabase setup

The app uses one Supabase project for the database, sign-in (Google and email link),
file storage and live job progress.

Two ways to get one. The schema and the code are the same for both.

| | Hosted project (easiest) | Local stack |
|---|---|---|
| Needs | A free account at supabase.com | Docker Desktop and the Supabase CLI |
| Good for | First run, deployment | Offline work, throw-away data |

## 1. Create the project

### Hosted
1. Create a project at <https://supabase.com/dashboard>.
2. **Authentication > Sign In / Providers**:
   - Keep **Allow anonymous sign-ins** OFF. The app has no guests: people sign in with Google or an emailed link,
     and the API refuses anonymous sessions even if this is switched on by mistake.
   - Turn on **Manual linking** (lets someone who signed in by email connect Google later, for "Save to Google
     Drive", without creating a second account).
   - **Email**: keep it on with **Confirm email** on (the sign-in link proves the address). Supabase's built-in mailer
     is limited to a few emails an hour: before launch add your own SMTP server (**Authentication > Emails > SMTP Settings**).
   - Turn on **Google** and paste your Google OAuth client id and secret (create them in the Google Cloud console as a
     "Web application"; add the callback URL shown on that Supabase page as an authorized redirect URI).
3. **Authentication > URL Configuration**: set **Site URL** to `http://localhost:3000` (your real domain later) and add
   these **Redirect URLs**: `http://localhost:3000/auth/callback`, `http://127.0.0.1:3000/auth/callback` (and the same
   paths on your real domain). Without them Google and email links cannot return to the app.
4. Apply the database schema (section 2).
5. Copy these values (**Project Settings > API** and **> Database**) into `.env` and `frontend/.env.local`
   (see `.env.example` and `frontend/.env.example`):
   `DATABASE_URL`, `SUPABASE_URL`, the public `anon` key, and the `JWT secret` only if your project still uses one.

### Local
```bash
supabase start        # uses supabase/config.toml: Google, email link and manual linking are on; anonymous sign-ins are off
```
The command prints the local URL and keys. The database URL is
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
Google needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your shell. Email links work without it (emails are
caught by the local Inbucket mailbox at <http://127.0.0.1:54324>).

## 2. Create the tables

The schema lives in `supabase/migrations/`. With the CLI:

```bash
supabase link --project-ref <your-project-ref>   # hosted only
supabase db push                                   # hosted
supabase db reset                                  # local (rebuilds from the migrations)
```

Without the CLI, open **SQL Editor** in the dashboard and run every file in
`supabase/migrations/` in order (they are numbered).

What it creates:

| Table | Purpose |
|---|---|
| `profiles` | One row per user: time zone, `daily_video_limit` (default 10) |
| `videos`, `transcripts`, `summaries` | Shared cache: a video processed once is reused for everyone |
| `user_videos` | Each user's library |
| `jobs` | The work queue and the record behind "x of 10 videos today" |
| `ip_usage` | Per-IP daily counter (addresses are stored hashed) |
| `video_outputs` | Flashcards, quiz, mind map and slides, generated once per video and shared |
| `share_links` | Public read-only links (random 256-bit tokens, can be revoked) |
| `generation_usage` | How many AI generations a user triggered today (default cap 60) |
| `study_sessions`, `daily_stats`, `goals`, `quiz_attempts` | Study time (measured by the server), daily totals per local day, daily goals, quiz history |
| `notes` | Each user's own notes per video |
| `playlists`, `playlist_items` | Playlists; items are YouTube ids or uploaded videos, ordered by a fractional key |
| `notifications`, `notification_prefs`, `push_subscriptions` | In-app notifications, per-channel choices, browser push subscriptions |

Security: every table has Row Level Security. Users can read only their own rows and cannot write.
All writes go through the backend. The functions that enforce the daily limit and run the queue are
not callable from the browser.

## 3. Run the app

```bash
# Backend (terminal 1)
pip install -r requirements.txt
cp .env.example .env            # fill in DATABASE_URL, SUPABASE_URL, an AI key
cd backend && uvicorn summarizer.main:app --port 8000

# Frontend (terminal 2)
cd frontend && cp .env.example .env.local   # fill in the two NEXT_PUBLIC_ values
npm install && npm run dev
```

In development the API process also runs the jobs. In production run the worker separately:

```bash
cd backend && python -m summarizer.features.jobs.worker
```

You can run several workers (even on other machines). They share the queue safely.
For workers on other machines set `FILE_STORE=supabase`, `SUPABASE_SERVICE_ROLE_KEY` and make sure
the `uploads` bucket exists (the migration creates it).

## 4. Changing a user's limits

The limit is data, not code. In the SQL editor:

```sql
update public.profiles set daily_video_limit = 25 where user_id = '<user id>';
```

The generation cap is the `GENERATION_DAILY_LIMIT` environment variable.

## 5. Study tools and sharing

- Open a video from **Library** (`/library`) to get its workspace (`/video/<id>`): player, summary, transcript,
  flashcards, mind map, slides and quiz. Each output is generated the first time it is opened, then stored and
  shared with everyone who has the same video. Opening a stored output is free; generating counts toward
  `GENERATION_DAILY_LIMIT` (default 60 per user per day).
- **Share** creates a public link `/s/<token>` that shows the summary, mind map and flashcards (never the
  transcript or quiz). It can be revoked at any time. Visitors of a public link do not need an account.
- **Export .md** downloads a study pack with everything that has been generated.

## 6. Study tools (Phase 3)

- **Study time** is measured by the server: the page sends a heartbeat every ~20 seconds and the server credits at
  most 45 seconds per heartbeat, once, even if several tabs are open. It counts while the video plays or the person
  is typing/scrolling (within 2 minutes), and only while the tab is visible.
- **Streak**: consecutive days (in the user's own time zone) with at least `STREAK_MIN_SECONDS` of study
  (default 600 = 10 minutes). It is computed from the daily totals, so it cannot drift.
- **Goals**: minutes studied, videos finished, quizzes taken. A video counts as finished at 90% watched.
- **Playlists**: create your own, or import a public YouTube playlist (no API key needed; importing does not
  summarize anything or use the daily video limit). Drag to reorder (only the moved row changes).
- **Notifications** (in-app, email, browser): each type and channel can be switched on or off, with optional
  quiet hours for email and browser alerts. Defaults: in-app on, email and browser off.
  - *Email* uses [Resend](https://resend.com): set `RESEND_API_KEY` and `EMAIL_FROM`.
  - *Browser push* needs a VAPID key pair: `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`,
    `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Only the push services of Chrome/Edge, Firefox and Safari are accepted.
  - The **worker** sends the evening streak reminder (about once every 10 minutes it checks who is due) and the
    "summary ready" notice. Make sure at least one worker is running.

## 7. Sign-in

- Pages other than the home page, the login page and public share links need an account. A visitor who opens one is
  sent to `/login` and brought back afterwards. Pasting a link on the home page while signed out sends the person to
  sign in and then summarizes that link.
- `/login` offers **Continue with Google** and **Email me a sign-in link** (no passwords). Both return to
  `/auth/callback`, which finishes the sign-in and goes on to the page the person wanted (only paths on this site
  are accepted as a destination).
- The API accepts only real accounts. A leftover anonymous (guest) session gets `403 account_required`.
- The old bot check for guests (Turnstile) was removed together with guests. Abuse is limited by the per-account
  daily limit and the per-address limit.

## Not verified here

The migrations, row-level security, daily limit and queue are tested against a real PostgreSQL in CI.
Running against a live Supabase project (Google sign-in, Realtime, Storage over the network) has not been
exercised yet and needs a first run with your own project.

## 7. Documents, device uploads and the resizable workspace (Phase 4)

Apply migration `20261110000007_documents_and_device_uploads.sql` (tables `documents` and `video_uploads`, a
`playlist_items.upload_id` column, and the `storage_used()` function).

- **Documents**: PDF, Word, PowerPoint, Excel, OpenDocument, RTF, text, Markdown, CSV and common images, up to
  `MAX_DOCUMENT_MB` each, `USER_STORAGE_QUOTA_MB` per user (documents plus uploaded videos), and
  `MAX_DOCUMENTS_PER_USER` files. A document can be attached to a video or kept on its own, and moved later.
  File contents are checked against the file type (not just the extension); executables, HTML, SVG, scripts and
  archives are refused. Files are always served as downloads through short-lived signed links.
- **Device video upload** (in a playlist): the file is stored and playable straight away. Summarizing is a separate
  step that uses the daily limit and the normal queue. It has not been run against real Whisper yet.
- With `FILE_STORE=supabase` the files live in the private storage bucket; no extra bucket policies are needed
  because the API signs the links.
- **Workspace**: the divider between the video and the notes can be dragged or moved with the arrow keys; double
  click or "Reset layout" restores the default. The choice is remembered per browser.

## 8. Editing the summary and slides (Phase 4b)

Apply migration `20261110000008_user_edits.sql` (`user_edits` and `user_edit_versions`).

- Edits belong to one user. The AI summary and slides are shared per video and are never changed, so one person's
  edit cannot alter what another person sees.
- Every change keeps the previous text as a version (the newest 20 are kept). "Back to the AI version" removes the
  edit but keeps it in the history, and any version can be restored (the replaced text becomes a version too).
- Saving checks the `updated_at` the editor last saw; if another tab saved since, the save is refused (409) rather
  than overwriting.
- "Export .md" uses the user's edited summary. Public share links still show the AI summary.
- The summary is a Markdown editor with live preview. Slides are edited with a form (title, heading, summary,
  bullets, layout, speaker notes, add/reorder/delete); the preview and the PowerPoint export use the edited slides.

## 9. Documents as context, Google Drive, mind map views, phone layout (Phase 4c)

Apply migration `20261110000009_user_outputs.sql`.

- **Use my documents**: on the Flashcards, Mind map, Presentation and Quiz tabs a switch appears when the video has
  at least one of your documents with readable text. The AI then also sees up to 12,000 characters of them
  (at most 6,000 per file). That result is stored in `user_outputs`, visible only to you, never in the shared
  `video_outputs`. It counts toward the daily generation limit, opening it again is free, and "Regenerate" makes a
  new one. Changing or deleting a document does not change a result already made; regenerate to refresh it.
- **Save to Google Drive** creates a Google Doc with the study pack (your edited summary included) in your own Drive.
  Setup (one time, in Google Cloud and Supabase):
  1. Enable the **Google Drive API** for the same Google Cloud project as your OAuth client.
  2. Add the scope `https://www.googleapis.com/auth/drive.file` to the OAuth consent screen (it only lets the app
     see files it created).
  3. In Supabase, add your site URL(s) to the redirect allow-list (the button returns to the video page).
  The browser asks Google for the permission only when the button is pressed, then sends the short-lived token to
  `POST /api/videos/{id}/export/drive`, which uploads once and forgets it (never stored, never logged). People who signed in by email are asked to connect Google first (it is linked to the same account). Not tested against live Google.
- **Mind map**: Radial, Left to right (logic chart), Top down (org chart) and the old Outline, over the same data.
  Drag to move, buttons or pinch to zoom, Fit, full screen, tap an idea to open/close it, PNG and SVG download.
  The chosen view is remembered per browser.
- **Phone layout**: below 640px the video/notes split becomes one scrolling page with the video pinned under the
  navigation bar (a button unpins it). Wider screens keep the resizable split.

## 10. Phone polish (Phase 4d)

Front-end only, nothing to apply. Checked in a real browser at 320, 360, 375, 414, 768 and 812x375 (landscape)
on every page: no sideways scrolling anywhere.

- **Menu**: the phone menu lives outside the navigation bar. (It used to sit inside it; the bar's blur made a
  fixed child size itself to the 64px bar, so the menu was cut to a sliver.) Sign-in and the light/dark switch moved
  into the menu on phones so the bar always fits.
- **Lists and forms**: a one-column grid now shrinks to the screen, so a long title no longer pushes a card or form
  off the edge (a global rule in `globals.css`, plus a test).
- **Playlist rows** put their buttons on their own line on a phone; titles wrap instead of being cut.
- **Video page**: the tab bar scrolls sideways (the chosen tab stays in view); the pinned video is at most about a
  third of the screen high.
- Form fields are 16px on phones (iOS zooms into smaller ones), buttons are at least 36px tall on touch screens.

## 11. Files beside the videos, icon actions, fixed navbar (Phase 4e)

Apply migration `20261110000010_playlist_documents.sql` (`documents.playlist_item_id`, `playlist_items.document_id`).

- **There is no separate Documents section any more.** Files live in the playlists, on the right of each video:
  a paperclip with the number of files opens a small panel to open, download, add and delete them. Drop files on a
  video row to attach them to it. The old `/documents` page still exists for checking storage but is not in the
  navigation. Each video page keeps a "Documents" tab (the same files).
- A file can also be a **row of its own** in a playlist ("Add a document", or drop files on the list). File rows
  are ordered by dragging, just like videos. Removing one deletes the file.
- A file attached to a video that is not summarized yet is kept on that playlist item; if the video is already in
  the library it is attached to the video as well. Removing a video from a playlist deletes files that only
  belonged to that item.
- **Opening files**: PDFs and pictures are shown inside the page (served with `Content-Disposition: inline`,
  `nosniff`, `frame-ancestors 'self'` and a short-lived signed address; never SVG or HTML). Word, slides,
  spreadsheets, OpenDocument, RTF, text and CSV show the text read from them (now also for xlsx, odt/odp/ods and
  rtf) with a download for the original. Old binary formats (.doc, .ppt, .xls) offer the download. Phones that
  cannot embed a PDF get "Open in a new tab" and "Show its text".
- Summary and transcript actions are icon-only (favorite, edit, copy) with one download menu (PDF, .txt, .md).
  Export and Save to Google Drive are one "Export" menu.
- The navigation bar is `position: fixed` (with a spacer) so it stays on screen in every browser.

## 12. Study sessions, focus timer and streaks (Phase 4f)

Apply migration `20261110000011_study_v2.sql` (`daily_stats.pomodoros`, `study_sessions.pomodoros` and `last_pomodoro_at`).

- **Study bar** under the video: this visit's timer, today's progress, the streak, and a three-dot menu:
  focus timer (Pomodoro), timer lengths and sounds, pause/resume tracking, a goal for this visit, restart this
  visit's timer, and a link to the stats page.
- **Focus timer (Pomodoro)**: presets (Classic 25/5, Deep work 50/10, Quick 15/3) or your own lengths (focus 5-180
  min, short break 1-30, long break 5-60, 2-8 blocks per round), automatic or manual breaks and next blocks, an
  end-of-block chime and notification. It is kept as an end time, so it stays right in a background tab and after
  a reload. Only focus time counts as study time; breaks and paused tracking do not. Settings and progress are
  saved in this browser only. A finished block is reported to the server (`POST /api/study/sessions/{id}/pomodoro`),
  which ignores repeats (blocks must be at least 4 minutes apart) and caps it at 48 a day.
- **Streaks** are computed from the daily totals in `study/streaks.py`. One missed day per calendar week
  (Monday to Sunday) is forgiven: it does not add to the streak but does not break it. Two misses in a row, or a
  second miss in the same week, break it. The study page shows the forgiven day and whether this week's is still
  available, and warns when the streak is at risk. The SQL function `streak_info` is no longer used by the API
  (the evening reminder query still uses it, so a reminder can be sent for a streak the app would have forgiven).
- **Study page**: this week (counted / forgiven / today / coming days), 12-week activity grid, totals for 30 days,
  where the time went (per video) and recent sessions, plus the existing 14-day chart and goals.
- New endpoints: `GET /api/study/sessions`, `GET /api/study/videos`, and the overview now includes `week`,
  pomodoros and the streak details.
