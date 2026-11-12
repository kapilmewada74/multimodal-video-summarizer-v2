"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, readError } from "../../lib/api";
import type { PlayerSnapshot } from "./youtube";

interface Props {
  uploadId: string;
  title?: string | null;
  startSeconds?: number;
  onUpdate?: (snapshot: PlayerSnapshot) => void;
  className?: string;
}

/** Plays a video (or audio file) that was uploaded from the device, using a temporary secure link. */
export function UploadedVideoPlayer({ uploadId, title, startSeconds = 0, onUpdate, className = "" }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const element = useRef<HTMLVideoElement>(null);
  const retried = useRef(false);
  const resumeAt = useRef(startSeconds);

  const loadLink = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/uploads/${uploadId}/stream-url`);
      if (!res.ok) throw new Error(await readError(res, "Could not open this video."));
      setUrl((await res.json()).url);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this video.");
    }
  }, [uploadId]);

  useEffect(() => {
    retried.current = false;
    setUrl(null);
    void loadLink();
  }, [loadLink]);

  const report = (ended = false) => {
    const el = element.current;
    if (!el || !onUpdate) return;
    onUpdate({
      playing: !el.paused && !el.ended,
      ended: ended || el.ended,
      position: el.currentTime || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      muted: el.muted,
      rate: el.playbackRate,
      ready: true,
    });
  };

  if (error) {
    return (
      <div role="alert" className={`flex items-center justify-center rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-sm ${className}`} style={{ aspectRatio: "16 / 9" }}>
        {error}
      </div>
    );
  }
  if (!url) {
    return (
      <div role="status" className={`flex items-center justify-center rounded-2xl bg-black text-sm text-white/70 ${className}`} style={{ aspectRatio: "16 / 9" }}>
        Loading video…
      </div>
    );
  }

  return (
    <video
      ref={element}
      src={url}
      controls
      playsInline
      preload="metadata"
      aria-label={title ? `Video: ${title}` : "Uploaded video"}
      className={`w-full rounded-2xl border border-[var(--card-border)] bg-black shadow-xl ${className}`}
      style={{ aspectRatio: "16 / 9" }}
      onLoadedMetadata={() => {
        if (element.current && resumeAt.current > 0) {
          element.current.currentTime = resumeAt.current;
          resumeAt.current = 0; // only the first time
        }
        report();
      }}
      onPlay={() => report()}
      onPause={() => report()}
      onTimeUpdate={() => report()}
      onEnded={() => report(true)}
      onError={() => {
        // The temporary link may have expired: get a new one, once.
        if (!retried.current) {
          retried.current = true;
          resumeAt.current = element.current?.currentTime ?? resumeAt.current;
          void loadLink();
        } else {
          setError("This video could not be played in your browser.");
        }
      }}
    />
  );
}
