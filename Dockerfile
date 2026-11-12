# Backend image (API and worker share it). CPU build; for GPU transcription
# start from a CUDA base image instead.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY backend/summarizer ./backend/summarizer
COPY assets ./assets

# Run as a non-root user and keep the working folder writable.
RUN useradd --create-home appuser \
    && mkdir -p data \
    && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/backend
EXPOSE 8000

# 0.0.0.0 is required inside a container; compose publishes the port on
# 127.0.0.1 only. The worker uses the same image with a different command.
CMD ["uvicorn", "summarizer.main:app", "--host", "0.0.0.0", "--port", "8000"]
