# Backend image: the API and the CPU worker share it (the command differs).
# For GPU transcription build Dockerfile.gpu instead.
FROM python:3.15-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY backend/summarizer ./backend/summarizer
COPY assets ./assets

# Run as a non-root user; only the data folder and the model cache are writable.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p data \
    && chown -R appuser:appuser /app/data /home/appuser
USER appuser
WORKDIR /app/backend

ARG RELEASE=dev
ENV RELEASE=${RELEASE} \
    ENVIRONMENT=production \
    LOG_FORMAT=json

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/live', timeout=4).status == 200 else 1)"

# tini forwards SIGTERM so uvicorn (and the worker) shut down cleanly when the container stops.
ENTRYPOINT ["tini", "--"]
CMD ["uvicorn", "summarizer.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "30"]
