"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { OutputWorkspace } from "../../components/OutputWorkspace";
import { apiFetch, readError } from "../../lib/api";
import type { VideoDetail } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { formatDuration } from "../library/format";
import { UploadedVideoPlayer } from "../player/UploadedVideoPlayer";
import { WorkspaceLayout } from "../layout/WorkspaceLayout";
import { YouTubePlayer } from "../player/YouTubePlayer";
import { ProgressThrottle, resumePosition, type PlayerSnapshot } from "../player/youtube";
import { StudyPanel } from "../study/StudyPanel";
import { useStudyTools } from "../study/useStudyTools";
import { isYouTubeId } from "./share";
import { VideoPane } from "./VideoPane";
import { VideoPlayer } from "./VideoPlayer";

interface Props {
  videoId: string;
  onToast: (message: string, type?: "success" | "info" | "error") => void;
}

/** One video: the player and every study tool (summary, transcript, flashcards, mind map, slides, quiz). */
export function VideoWorkspace({ videoId, onToast }: Props) {
  const { ready, signedIn, configured } = useAuth();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const throttle = useRef(new ProgressThrottle());
  const resumeAt = useRef<number | null>(null);

  // The saved position is read once, when the video first loads, so saving progress never restarts the player.
  if (video && resumeAt.current === null) {
    resumeAt.current = resumePosition(video.progress_seconds ?? 0, video.duration, Boolean(video.completed));
  }

  const loadedId = video?.id ?? null;
  const studying = video?.status === "ready";
  const tools = useStudyTools(loadedId, playing, studying, onToast);

  const handlePlayer = useCallback(
    (snap: PlayerSnapshot) => {
      setPlaying(snap.playing);
      if (!loadedId) return;
      const position = throttle.current.next(Date.now(), snap.position, snap.playing, snap.ended);
      if (position !== null) {
        void apiFetch(`/api/videos/${loadedId}/progress`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position_seconds: position, duration_seconds: Math.floor(snap.duration) || undefined }),
          keepalive: true,
        }).catch(() => undefined);
      }
    },
    [loadedId],
  );

  useEffect(() => {
    if (!ready || !signedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await apiFetch(`/api/videos/${videoId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "We could not find this video in your library." : await readError(res));
          return;
        }
        const data: VideoDetail = await res.json();
        setVideo(data);
        setError(null);
        // A video that is still being processed refreshes itself.
        if (data.status === "pending" || data.status === "processing") {
          timer = setTimeout(load, 4000);
        }
      } catch {
        if (!cancelled) setError("Could not load this video. Check your connection and reload.");
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoId, ready, signedIn]);

  const back = (
    <Link href="/library" className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]">
      <ArrowLeft className="h-4 w-4" /> Library
    </Link>
  );

  if (!configured) {
    return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Sign-in is not configured for this app yet.</div>;
  }
  if (error) {
    return (
      <div>
        {back}
        <div role="alert" className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!video) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--text-muted)]" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const meta = [formatDuration(video.duration), video.source === "youtube" ? "YouTube" : "Uploaded file"].filter(Boolean).join(" · ");

  const player = isYouTubeId(video.youtube_id) ? (
    <YouTubePlayer videoId={video.youtube_id} title={video.title} startSeconds={resumeAt.current ?? 0} onUpdate={handlePlayer} />
  ) : video.upload_id ? (
    <UploadedVideoPlayer uploadId={video.upload_id} title={video.title} startSeconds={resumeAt.current ?? 0} onUpdate={handlePlayer} />
  ) : (
    <VideoPlayer youtubeId={null} title={video.title} />
  );

  const videoPane = (
    <VideoPane
      player={player}
      footer={
        <>
          <p className="text-xs text-[var(--text-muted)]">{meta}</p>
          {studying && <StudyPanel tools={tools} />}
        </>
      }
    />
  );

  const panel = (
    <div className="workspace-pane min-w-0 p-1">
      {video.status === "ready" && video.summary !== null ? (
        <OutputWorkspace
          videoId={video.id}
          onToast={onToast}
          result={{
            title: video.title || "Video",
            duration: video.duration,
            transcript: video.transcript || "",
            summary: video.summary,
            engine: video.engine ?? undefined,
          }}
        />
      ) : video.status === "failed" ? (
        <div role="alert" className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-sm">
          This video could not be processed. Go back and try it again.
        </div>
      ) : (
        <div role="status" className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-center text-sm text-[var(--text-muted)]">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="font-semibold text-[var(--text-main)]">Your study notes are being prepared…</p>
          <p>This page updates on its own when they are ready.</p>
        </div>
      )}
    </div>
  );

  return (
    <div>
      {back}
      <WorkspaceLayout video={videoPane} panel={panel} />
    </div>
  );
}
