# Audit Report: Multimodal Video Summarizer

Audited: 2026-11-10. Scope: the whole repo, read statically. Backend, both frontends, config, dependencies, tests and docs. I did not run the app, so runtime claims come from reading the code. I ran `npm audit` and `pyflakes`, and checked git history for leaked files.

---

## 1. What the project is

A web app that turns a YouTube link or an uploaded audio/video file into study material: a transcript, a markdown summary with LaTeX math, flashcards, a slide outline, a downloadable `.pptx` and a quiz.

**Pipeline** (`services.py`):
1. A YouTube URL is checked by regex.
2. `yt-dlp` fetches the title and duration.
3. `youtube-transcript-api` tries captions first. Otherwise the audio is downloaded at 144p, run through `ffmpeg`, and transcribed with Faster-Whisper `small`.
4. Hindi script is transliterated to Roman letters (ITRANS).
5. Groq (`openai/gpt-oss-20b`) writes the summary in one call, with Gemini as fallback.
6. The result is saved to `output/` and `history.json` (last 20 jobs).

**Generators** (`generators.py`):
- Flashcards and slides use Gemini REST.
- The quiz uses xAI Grok, then Gemini.
- Each has a "local" fallback (see finding H-5).
- `build_pptx_file` renders three PPTX themes with `python-pptx`.

**Serving:** FastAPI (`app.py`) runs on 127.0.0.1:8000. It runs jobs in daemon threads and keeps job state in an in-memory dict. There are two UIs:
- A legacy vanilla one: `static/index.html` plus a 2018-line `static/js/app.js`.
- A Next.js 15 / React 19 / Tailwind 4 app in `frontend/`, which proxies `/api/*` to the backend.

| Area | Size |
|---|---|
| Python backend | about 3,100 lines in 7 files |
| Next.js frontend | about 6,500 lines of TSX |
| Legacy UI | about 4,000 lines of JS, HTML and CSS |

The repo is a git repo with 15+ commits from two contributors.

---

## 2. Scorecard

| Area | Grade | Summary |
|---|---|---|
| Functionality / design | B | The caption-first approach is smart, and the generators have layered fallbacks. |
| Security | D | Unsanitized HTML injection, an upload path-traversal bug, API key in URLs, and no auth or limits. |
| Reliability / concurrency | D+ | Shared fixed file paths, a blocked event loop, a memory leak and unlocked file writes. |
| Code quality | C- | About 1,200 lines of commented-out code, duplicated UIs, and unused imports. |
| Testing | D | One live-server script. It passes even when every AI provider fails. |
| Docs / DX | C- | The README promises features that don't exist, and its setup steps are incomplete. |
| Dependencies | C | Nothing is pinned, `torch` is missing from requirements, and `npm audit` finds 3 issues. |

**Overall: a good prototype. It is not safe to expose beyond localhost, and it will misbehave with more than one concurrent user.**

---

## 3. Findings

Severity: **C** critical, **H** high, **M** medium, **L** low.

### Security

**H-1. Cross-site scripting through summary rendering.**
- **Where:**
  - `static/js/app.js:1657` calls `innerHTML = marked.parse(summary)`.
  - `frontend/src/components/OutputWorkspace.tsx:543` and `MathText.tsx:33` use `dangerouslySetInnerHTML`.
  - `frontend/src/lib/mathUtils.ts:16` sets KaTeX `trust: true`.
  - `mathUtils.ts:20-21` puts the raw LaTeX string into HTML when KaTeX fails.
- **Why it matters:** the summary comes from an LLM that read attacker-controllable text (captions, spoken words, uploaded media). A video that says "output `<img src=x onerror=...>`" can produce HTML or script in your page. The `katex-error` path is the easiest to reach: broken LaTeX is injected unescaped.
- **Also affected:** `app.js` puts `err.message` and other server strings into `innerHTML` (lines 569, 802, 1408). The FAQ, quiz and flashcard views have not been checked as thoroughly.
- **Fix:** sanitize all rendered HTML with DOMPurify. Set `trust: false`. Escape the LaTeX string in the error fallback. Use `textContent` for error messages.

**H-2. Path traversal in upload.** `app.py:166-170`:
```python
saved_filename = f"upload_{job_id}_{file.filename}"
saved_path = os.path.join(DOWNLOAD_DIR, saved_filename)
```
- The extension check runs on the raw name. A filename like `../../x/evil.mp4` passes the check and the file is written outside `downloads/`.
- There is no size limit either, so a large upload can fill the disk.
- **Fix:** use `os.path.basename`, or better, ignore the client name and use `f"{job_id}{ext}"`. Stream the upload in chunks and cap its size.

**H-3. Gemini key sent in the URL and probably logged.**
- `generators.py:108` builds `...:generateContent?key={key}`.
- `services.py:62` sets `logging.basicConfig(level=INFO)`.
- `httpx` logs every request at INFO, including the full URL. So the key is likely written to the console and any log file.
- **Fix:** send it in the `x-goog-api-key` header and set the `httpx` logger to WARNING.

**H-4. No authentication, rate limiting or quotas.**
- CORS is `allow_origins=["*"]` with `allow_credentials=True` (`app.py:72-78`). That combination is invalid and unsafe.
- Anyone who can reach the port can start unlimited jobs. Each job burns Groq, Gemini and xAI quota and downloads video.
- Job ids are only 8 hex characters (`uuid4()[:8]`), so they can be guessed. `/api/history` returns every user's full transcripts to anyone.
- It is fine while bound to 127.0.0.1, but the README and `next.config.ts` (`BACKEND_API_URL`) invite deployment.
- **Fix:** set explicit origins, add an API key or session, add rate limits, use full UUIDs and per-user history.

**M-1. Unbounded work per request.**
- No duration cap on YouTube downloads, no timeout on `ffmpeg`, no limit on the length of `PptxRequest.slides`, and no cap on the transcript fields (`GenerateRequest.summary` and `transcript` have no maximum length).
- **Result:** easy denial of service.

**M-2. Secrets handling.**
- `.env` holds live-looking Gemini, xAI and Groq keys. I checked that `.env` is gitignored and was never committed, which is good.
- Rotate the keys if the folder was ever zipped or shared.
- `GROK_API_KEY` and `XAI_API_KEY` are duplicates.
- The client may also send `apiKey` in request bodies (`GenerateRequest.apiKey`). For flashcards and slides it is accepted and ignored. For the quiz it is used. Remove the field, because keys should not travel through the browser.

**L-1.** `/api/health` imports `torch` on every call. If torch is missing, the endpoint returns a 500.

---

### Reliability and correctness

**H-5. The "local Qwen" fallback does not work.** `generators.get_local_llm()` returns `services.get_llm()`, which returns the Groq client, not a LangChain model.
- `chat_prompt | llm | StrOutputParser()` therefore raises, and execution always drops to the rule-based fallback.
- The quiz fallback is a single question whose correct answer is the video title.
- `.env.example`, the app description and UI strings still say Qwen/MPS/CPU.
- Either implement a real local model or remove the claims. Tell the user when output came from a stub.

**H-6. Concurrent jobs corrupt each other.**
- `pipeline.py` writes to fixed paths: `audio/audio.wav`, `downloads/youtube_video.*`.
- `services._summarize_and_complete` writes the global `output/transcript.txt` and `summary.txt`.
- Two simultaneous URL jobs will overwrite each other's audio or transcript. This can produce a summary of the wrong video.
- `_append_history` does an unlocked read-modify-write on `history.json`, so concurrent writes lose entries.
- Fix: use per-job file names and a lock around history writes.

**H-7. The blocking event loop.** The `async def` endpoints `api_generate_*` call synchronous `httpx.Client` code (up to 16 s per model, 3 models, plus a local-LLM attempt). While they run, the whole server is frozen, including job polling for other users. Use plain `def` endpoints, `run_in_threadpool`, or an async client.

**M-3. Memory and process growth.**
- `jobs` is never pruned. Each completed job keeps its full transcript and summary forever.
- `_GENERATION_CACHE` is unbounded.
- A new thread is started per request with no cap.
- `run_pipeline_for_*` calls `pipeline.load_whisper()` directly on every job instead of the cached `get_whisper_model()` (`services.py:264, 319`). This reloads the model into RAM each time.

**M-4. The Gemini fallback produces the wrong output.** In `_summarize_and_complete`, the summary prompt is sent through `_call_gemini_rest`, which forces `responseMimeType: application/json`.
- The prompt still contains the literal `{transcript}` placeholder, followed by the transcript appended again.
- The timeout is 16 s, which is too short for long transcripts.
- Expect JSON-wrapped or truncated summaries whenever Groq fails.

**M-5. Long videos fail.** `summarize.generate_summary` sends the whole transcript in one request with a 4,000-token output cap. A long lecture can exceed the model context. The old chunk-and-merge logic exists only in commented-out code, though the README implies it.

**M-6. `main.py` can summarize a stale transcript.** `pipeline.main()` catches every exception and exits with code 0 (`pipeline.py:1147-1153`). `main.py` only checks the exit code and whether `output/transcript.txt` exists. That file persists from the previous run, so a failed download silently summarizes the old transcript.

**M-7. Non-ASCII titles crash PPTX download.** `app.py:314-319` puts the title into `Content-Disposition`. HTTP headers are latin-1, so a Hindi or Unicode title raises an error and the endpoint returns a 500. This matters because the app explicitly supports Hindi. Use RFC 5987 (`filename*=UTF-8''...`) and strip control characters.

**M-8. Other logic issues.**
- `clean_and_deduplicate_summary` deletes every CJK character, which also destroys legitimate Chinese, Japanese and Korean content.
- Captions in languages other than English or Hindi are not translated (only the Whisper path translates).
- The "provider" field is set to `""` for Gemini results, so the UI cannot show the source.
- Whisper uses CPU on Apple Silicon (no MPS path), so transcription is slow on this machine.
- `_get_gemini_models` prefers a model name like `gemini-3.5-flash-lite`, and the quiz uses `grok-2-mini`. Confirm both still exist, since a retired name silently falls back to the next provider.

**L-2.** The cache key uses `md5(title + summary[:300])`. Two different videos with the same first 300 characters collide. `force_refresh` for the quiz does not delete the old entry before regenerating.

**L-3.** The frontend polls every 600 ms with no backoff and no overall timeout, so a stuck job polls forever.

---

### Code quality and maintainability

- **Commented-out code:** `main.py` (about 175 lines), `pipeline.py` (about 550 lines) and `summarize.py` (about 470 lines) carry old versions. Roughly 1,200 lines are dead. Git already keeps history, so delete them.
- **Duplicated UI:** the legacy `static/` UI and the Next.js UI implement the same features, with duplicated assets (`static/templates` and `frontend/public/templates`). Decide which one is supported.
- **Duplicated hacks:** the `SafeStream` stdout wrapper is copy-pasted in `app.py` and `services.py`. It hides terminal errors, and `pipeline.py` and `main.py` each also call `reconfigure`.
- **Import side effects:** importing `pipeline.py` creates directories, imports `faster_whisper`, and imports torch. Config is a module-level global.
- **Lint:** pyflakes reports unused imports in `app.py`, `generators.py`, `services.py` and `test_suite.py`, plus an f-string without placeholders at `summarize.py:784`.
- **Error handling:** about 39 broad `except Exception` blocks, many of which silently `pass`. Failures disappear without a log line.
- **`generators.py`** is 1,142 lines and mixes prompts, parsing, caching, API clients and three PPTX renderers. The PPTX code alone is about 570 lines of repeated layout code and should be data-driven or split out.
- **Repo hygiene:** `.DS_Store` and `__pycache__` are in the folder (ignored by git). `frontend/.next` is 97 MB and `node_modules` is 431 MB locally, both untracked.

---

### Dependencies

- **Python:** `requirements.txt` has no version pins. It omits `torch`, which `app.py` and `pipeline.py` import, and `numpy`-type transitive needs. It lists `langchain-core` and `langchain-text-splitters`, but `langchain-text-splitters` is now unused. Pin versions, or use `pip-compile` or `uv`.
- **Node:** `npm audit --omit=dev` reports **3 vulnerabilities (1 low, 1 moderate, 1 high)**, tracing to `next` and `postcss`. Update `next` to a patched release. `next lint` in `package.json` is deprecated in newer Next versions.
- `framer-motion` and `motion` are both listed. `motion` is the renamed package, so keep one.
- **System requirements** such as `ffmpeg` are not checked at start-up. A missing `ffmpeg` only fails mid-job.

---

### Testing

- `test_suite.py` is a script, not a test suite. It needs a running server on port 8000, live internet and real API keys.
- Test 3c starts a real YouTube job as a side effect.
- Its assertions are weak. Flashcards, slides and quiz endpoints "pass" because the rule-based fallback returns the right keys, even if every provider fails. The Qwen failure in H-5 would go unnoticed.
- No unit tests exist for the pieces most worth testing: `is_valid_youtube_url`, `extract_video_id`, `_parse_json_safely`, `_sanitize_presentation_data`, `clean_and_deduplicate_summary`, and PPTX generation.
- There is no frontend test and no CI configuration.

---

### Documentation

- The README lists a **RAG knowledge assistant** as a feature and shows it in the architecture diagram. No retrieval or chat code exists. Move it to "Future Enhancements" only.
- The setup steps only show the Windows venv activation, never tell you to install `ffmpeg`, and say "configure the required environment variables" without listing them (`GROQ_API_KEY`, `MODEL_NAME`, `GEMINI_API_KEY`, `XAI_API_KEY`).
- The README is missing a how-to for running the legacy UI vs. the Next UI.
- No LICENSE file exists, although the README refers to one.
- `.env.example` is missing `GROQ_API_KEY` and `MODEL_NAME`, the two keys the main path needs, and its text about a Qwen fallback is inaccurate.
- Documentation links point to the upstream GitHub repo, not this copy.

---

## 4. What is done well

- The captions-first strategy is a real speed and cost win, with Whisper as a clean fallback.
- Strict YouTube URL validation (`is_valid_youtube_url`, `extract_video_id`) closes off SSRF through `yt-dlp`.
- Secrets are kept out of git, and `.gitignore` covers outputs, media and virtualenvs.
- PPTX files are built in memory, and stale files are cleaned up.
- The generators sanitize LLM output against fixed budgets, and fall back instead of returning a 500.
- The frontend is typed, has error and not-found boundaries, offline detection, theme persistence and ARIA roles on alerts and toasts.
- The design system is documented in `docs/UI_DESIGN_SYSTEM.md`.

---

## 5. Prioritized action plan

**Do first (about 1 day)**
1. Sanitize all HTML with DOMPurify, set KaTeX `trust: false`, and escape the error fallback (H-1).
2. Sanitize the upload filename and cap upload size (H-2).
3. Move the Gemini key to a header and quiet the `httpx` logger (H-3).
4. Make the `async def` generator endpoints non-blocking (H-7).
5. Fix the non-ASCII `Content-Disposition` header (M-7).

**Next (about 2-3 days)**
6. Use per-job file paths, add a history lock, and prune old jobs (H-6, M-3).
7. Reuse the cached Whisper model (M-3).
8. Fix the Gemini fallback prompt and MIME type (M-4).
9. Either implement the local model or delete the claims and dead branch (H-5).
10. Add chunking for long transcripts (M-5).
11. Add CORS origins, rate limits and basic auth if you deploy anywhere beyond localhost (H-4, M-1).

**Cleanup**
12. Delete about 1,200 lines of commented code and pick one UI.
13. Pin dependencies, add `torch`, update `next`, and run `npm audit fix`.
14. Write real pytest unit tests for the pure functions and mock the provider calls. Add CI.
15. Correct the README (remove RAG, add full setup steps), and add a LICENSE and a complete `.env.example`.

---

## 6. Limits of this audit

I did not run the app, so the runtime effects in H-3, H-5 and H-7 and the 500 in M-7 are inferred from the code. Model names (`gemini-3.5-*`, `grok-2-mini`, `openai/gpt-oss-20b`) need checking against each provider's current catalog. I did not deep-read every file in `frontend/src/components` (`GlassSurface`, `ScrollStack`, `TiltedCard`, `FeaturesSection` are visual only) or the full body of `static/js/app.js` and `design-system.css`. The XSS sinks listed are those found by search, so more may exist.
