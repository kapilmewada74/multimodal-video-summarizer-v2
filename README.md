# Multimodal Video Summarizer

**An AI-powered platform for video summarization, transcript extraction, and study material generation.**

Transform lengthy videos into concise, structured, and meaningful summaries. This project combines multimodal processing, automatic speech recognition, and generative AI to help users understand educational content efficiently.

---

## Overview

The **Multimodal Video Summarizer** is an AI-powered application designed to extract meaningful information from video and audio content and convert it into structured, easy-to-understand summaries.

Users can provide video URLs or upload their own video and audio files. The system extracts spoken content, generates transcripts, and processes the extracted information using AI-powered summarization techniques.

From the summary it can also generate flashcards, a slide outline with a downloadable PowerPoint file, and a multiple-choice quiz.

Whether you are a student, researcher, educator, or professional, this application helps reduce the time required to understand lengthy video content.

---

## Key Features

### 1. Video Summarization
- Summarize videos directly from supported URLs.
- Upload local video files for summarization.
- Extract meaningful information from lengthy videos.
- Generate concise and structured summaries.
- Organize generated content into meaningful sections.

### 2. Audio & Transcript Processing
- Support audio and video uploads.
- Extract transcripts from video content.
- Use YouTube transcript extraction when available.
- Automatic speech recognition using Faster-Whisper as a fallback.
- Support multilingual speech recognition.

### 3. AI-Powered Summarization
- Convert lengthy transcripts into concise summaries.
- Generate structured educational notes.
- Preserve important concepts and technical information.
- Organize information using headings and bullet points.
- Reduce unnecessary conversational content.

### 4. Study Tools
- Each video gets its own page: YouTube player plus summary, transcript, flashcards, mind map, slides and quiz.
- Everything is generated once per video and saved, so reopening it is instant.
- Try it without an account (a small free daily allowance); signing in keeps your work and unlocks the library, uploads and study tools.
- "Regenerate" makes your own new version of flashcards, quiz, mind map or slides. The shared copy other people see is never overwritten.
- Library of your videos, a public read-only share link (with WhatsApp) and a Markdown export.
- A customized YouTube player (our own controls). Paste a link and the player appears right away.
- Study tools: a study timer, daily goals, streaks, notes, playlists (import from YouTube, drag to reorder) and notifications.
- Flashcards with LaTeX math rendering.
- Slide outline and `.pptx` download (two visual templates).
- Multiple-choice quiz with adjustable difficulty.
- If no AI key is configured, these fall back to simple rule-based output and say so.

### 5. Support and Administration
- A Contact page (no account needed) sends messages to a support inbox.
- An admin panel for a few main leads (admins) and support staff (sub-admins): tickets and email replies, users, videos, staff roles and an append-only audit log. See [docs/ADMIN_PANEL.md](docs/ADMIN_PANEL.md).

### 6. Modern Web Interface
- Modern and responsive user interface.
- Easy video and audio upload workflow.
- Simple URL-based video processing.
- Organized presentation of generated summaries.
- User-friendly frontend experience.

---

##  System Architecture

The application follows a modular architecture that separates the frontend, backend, media processing, transcription, and AI summarization components.

```text
              USER
                |
                v
       FRONTEND APPLICATION
                |
                v
         BACKEND API
                |
                v
       INPUT PROCESSING
          /         \
         /           \
   VIDEO URL      FILE UPLOAD
         \           /
          \         /
                |
                v
        AUDIO EXTRACTION
                |
                v
       TRANSCRIPTION ENGINE
          /          \
         /            \
 YouTube Transcript  Faster-Whisper
         \            /
          \          /
                |
                v
         GENERATED TRANSCRIPT
                |
                v
        AI SUMMARIZATION
                |
                v
       STRUCTURED SUMMARY
                |
                v
   FLASHCARDS / SLIDES / QUIZ
                |
                v
        RESULTS TO THE USER
```

---

## Technology Stack

| Component | Technologies |
|---|---|
| Programming Language | Python |
| Frontend | Next.js, React, TypeScript |
| Backend | FastAPI |
| Database, sign-in, storage | Supabase (PostgreSQL, Auth, Storage, Realtime) |
| Job queue | PostgreSQL (no separate queue service) |
| Styling | Tailwind CSS |
| Speech Recognition | Faster-Whisper |
| Video Processing | yt-dlp, FFmpeg |
| Transcript Extraction | YouTube Transcript API |
| AI Summarization | Large Language Models (LLMs) |
| GPU Acceleration | CUDA, cuDNN |
| API Communication | REST API |
| Version Control | Git & GitHub |

---

## Installation & Setup

Follow these steps to run the project locally.

### Prerequisites

Install these once on your machine (they are not part of the repository):

| Tool | Version | Notes |
|---|---|---|
| Python | 3.10 or later (tested with 3.12) | `python3 --version` |
| Node.js and npm | 20 or later (tested with 24) | `node --version` |
| Git | any recent | |
| FFmpeg | any recent | `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Linux). Required for audio extraction. |
| PostgreSQL server binaries | 14 or later | Only to run the backend tests (`brew install postgresql@16`). The app itself uses Supabase. |
| NVIDIA GPU and CUDA | optional | Detected automatically; speeds up speech recognition. |

You also need accounts and keys that are never stored in the repository: a Supabase project (free tier is enough for
development) and at least one AI key (for example Groq). Without an AI key the study tools fall back to simple
rule-based output.

### 1. Clone the Repository

```bash
git clone https://github.com/RahulDhakad01/multimodal-video-summarizer.git
```

Navigate to the project directory:

```bash
cd multimodal-video-summarizer
```

### 2. Create a Supabase project

The app stores users, videos and jobs in Supabase (Postgres, sign-in, storage). Follow
[docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md): create a project, turn on Google and email sign-in (and
anonymous sign-ins for the free try-out), and apply the migrations in `supabase/migrations/`.

### 3. Backend Setup

```bash
python3 -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt                       # FFmpeg must also be installed
cp .env.example .env                                  # fill in DATABASE_URL, SUPABASE_URL and an AI key
cd backend
uvicorn summarizer.main:app --host 127.0.0.1 --port 8000
```

In development the API also runs the jobs. In production run workers separately:
`python -m summarizer.features.jobs.worker`.

The speech-recognition model is **not** in the repository: it downloads automatically the first time a video
without captions needs it (a few hundred MB for the default `small` model) and is cached in
`~/.cache/huggingface`, so the download happens once per machine.

### 4. Frontend Setup

In a second terminal:

```bash
cd frontend
cp .env.example .env.local        # NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open <http://localhost:3000>. A visitor can paste a YouTube link and get the summary, transcript, flashcards, mind map, slides and quiz without
an account (a free try-out of 2 videos per day). Signing in with Google or an emailed link keeps what they made and
unlocks the library, playlists, study tools, notes, documents and uploads (10 videos per day).

### Setting up again on a new machine (or after deleting the folder)

Your data lives in your Supabase project, so it survives deleting the local folder. Only these local files are
ignored by git, and must be recreated:

| File | What to do |
|---|---|
| `.env` (project root) | Copy `.env.example` and fill it in, or restore your saved copy. |
| `frontend/.env.local` | Copy `frontend/.env.example` and fill it in, or restore your saved copy. |
| `venv/` and `frontend/node_modules/` | Recreated by the install commands above. |
| `data/` | Local uploads and temporary media. Not needed to start; it is created on demand. |

Keep a private copy of both `.env` files (for example in a password manager): they hold keys that cannot be rebuilt
from the repository. Never commit them.

### 5. Make yourself an admin (optional)

Sign in to the site once, then give your account the admin role (a dry run is the default; add `--apply` to do it):

```bash
python3 scripts/grant_staff.py --email you@example.com
python3 scripts/grant_staff.py --email you@example.com --apply
```

An **Admin panel** item then appears in your account menu. Further staff are added from the panel. Details:
[docs/ADMIN_PANEL.md](docs/ADMIN_PANEL.md).

### 6. Run with Docker (optional)

```bash
docker compose up --build
```

Starts the API, a separate worker and the web app. The database is your Supabase project.

For a real server (HTTPS, workers, GPU, CI/CD, monitoring, load tests, cost) see the
[Deployment guide](docs/DEPLOYMENT.md) and the [Operations runbook](docs/RUNBOOK.md).

### 7. Run the tests

Backend (needs the PostgreSQL server binaries installed; the database tests are skipped without them):

```bash
pip install -r requirements-dev.txt
python -m pytest
```

Frontend:

```bash
cd frontend
npm test
npm run typecheck
```

Both run automatically on every pull request through GitHub Actions.

### Whisper model size

Speech recognition uses the `small` model by default. Set `WHISPER_MODEL` (for example `medium` or `large-v3`) for better accuracy on a machine with an NVIDIA GPU. A GPU is detected automatically.

---

## Application Workflow

1. **Input:** Provide a supported video URL or upload a video/audio file.
2. **Processing:** The backend processes the input and extracts audio when required.
3. **Transcription:** The system retrieves an available transcript or generates one using speech recognition.
4. **Summarization:** The extracted transcript is processed by an AI language model.
5. **Knowledge Generation:** The application organizes the extracted information into structured content.
6. **Output:** The generated summary is presented through the web interface.

---

## Project Documentation

Detailed technical documentation and design specifications are available below:

- [**UI Design System & Architecture Specification**](https://github.com/RahulDhakad01/multimodal-video-summarizer/blob/main/docs/UI_DESIGN_SYSTEM.md) — Design guidelines, design tokens, component anatomy, interface structure, and product workflows.
- [**Deployment guide**](docs/DEPLOYMENT.md) and [**Operations runbook**](docs/RUNBOOK.md) — cloud architecture, release process, what the owner must set up, security checklist, on-call steps.
- [**Supabase setup**](docs/SUPABASE_SETUP.md) — database, sign-in and storage.
- [**Admin panel, support and shared study sets**](docs/ADMIN_PANEL.md) — roles, the Contact page, regenerate rules and the audit log.
- [**Contributing Guide**](https://github.com/RahulDhakad01/multimodal-video-summarizer/blob/main/CONTRIBUTING.md) — Guidelines for contributing to the project.

---

## Future Enhancements

Potential areas for future development include:

- Retrieval-Augmented Generation (RAG) chat over video content.
- Interactive question-answering over video content.
- Automatic generation of educational notes and study materials.
- Timestamp-based summary navigation.
- Improved multilingual transcription and summarization.
- Video chapter detection and topic segmentation.
- Export summaries into PDF and other document formats.
- Improved processing performance and scalability.

---

##  Contributing

Contributions are welcome!

If you would like to improve this project, fix a bug, optimize the summarization pipeline, introduce new features, or improve the documentation, you are welcome to contribute.

Please read the [**Contributing Guide**](https://github.com/RahulDhakad01/multimodal-video-summarizer/blob/main/CONTRIBUTING.md) before submitting changes.

### Quick Contribution Workflow

1. Fork the repository.
2. Clone your fork.
3. Create a new branch.
4. Make your changes.
5. Test your changes.
6. Push your branch.
7. Open a Pull Request.

[**Read the Full Contributing Guide**](https://github.com/RahulDhakad01/multimodal-video-summarizer/blob/main/CONTRIBUTING.md)

---

## Developer

**Rahul Dhakad**

- GitHub: [@RahulDhakad01](https://github.com/RahulDhakad01)
- Project Repository: [Multimodal Video Summarizer](https://github.com/RahulDhakad01/multimodal-video-summarizer)

---

##  License

Please refer to the repository's license file for licensing information.

---



<p align="center">
   If you find this project useful, consider giving it a star!
</p>
