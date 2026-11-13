"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { OutputWorkspace } from "../../components/OutputWorkspace";
import { apiFetch, readError } from "../../lib/api";
import type { VideoDetail } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { SignInCard, SignInNudge } from "../guest/SignInCard";
import { YouTubePlayer } from "../player/YouTubePlayer";
import { WorkspaceCard } from "./WorkspaceCard";
import { isYouTubeId } from "../workspace/share";

interface Props {
  videoId: string;
  onToast: (message: string, type?: "success" | "info" | "error") => void;
}

/**
 * The finished summary with every study tool (summary, transcript, flashcards, mind map, slides, quiz).
 * A guest sees all of it; the full workspace (player with notes and study timer, playlists, documents) needs an account.
 */
export function SummaryResult({ videoId, onToast }: Props) {
  const { ready, configured, hasSession, signedIn } = useAuth();
  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    if (!ready || !hasSession) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await apiFetch(`/api/videos/${videoId}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "We could not find this summary. It may belong to another browser or session." : await readError(res));
          return;
        }
        const data: VideoDetail = await res.json();
        setVideo(data);
        setError(null);
        if (data.status === "pending" || data.status === "processing") timer = setTimeout(load, 4000);
      } catch {
        if (!cancelled) setError("Could not load this summary. Check your connection and reload.");
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoId, ready, hasSession]);

  const home = (
    <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]">
      <ArrowLeft className="h-4 w-4" /> Summarize another video
    </Link>
  );

  if (!configured) {
    return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Sign-in is not configured for this app yet.</div>;
  }
  if (!ready) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  // No session at all: a link opened in a fresh browser. A summary is private to whoever made it.
  if (!hasSession || error) {
    return (
      <div>
        {home}
        <div role="alert" className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-sm">
          <p>{error ?? "This summary is not available here. Paste a video link on the home page to make one."}</p>
          <Link href="/" className="mt-4 inline-block rounded-full bg-[var(--brand-lime)] px-5 py-2 text-sm font-black text-[#0E0F0C]">Go to the home page</Link>
        </div>
      </div>
    );
  }
  if (!video) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div>
      {home}
      {isYouTubeId(video.youtube_id) && (
        <div className="mx-auto mb-6 max-w-2xl" aria-label="Video preview">
          <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Preview</p>
          <YouTubePlayer videoId={video.youtube_id} title={video.title} />
        </div>
      )}

      <div className="mb-6">
        <WorkspaceCard href={`/video/${video.id}`} locked={!signedIn} onLockedClick={() => setPromptOpen(true)} />
      </div>

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

      {promptOpen ? (
        <SignInCard
          title="Unlock the full workspace"
          message="Sign in free to keep this summary and open it with the video player, notes and study timer."
          next={`/video/${video.id}`}
          onClose={() => setPromptOpen(false)}
        />
      ) : (
        video.status === "ready" && <SignInNudge />
      )}
    </div>
  );
}
