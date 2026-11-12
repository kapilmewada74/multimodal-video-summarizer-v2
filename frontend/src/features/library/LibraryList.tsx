"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Loader2, Trash2, Video } from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import type { VideoSummary } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { displayTitle, formatAdded, formatDuration, statusLabel } from "./format";

const PAGE = 30;

export function LibraryList({ onToast }: { onToast: (message: string, type?: "success" | "info" | "error") => void }) {
  const { ready, signedIn, configured } = useAuth();
  const [items, setItems] = useState<VideoSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/videos?limit=${PAGE}&offset=${offset}`);
      if (!res.ok) throw new Error(await readError(res, "Could not load your library."));
      const data = await res.json();
      setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready && signedIn) void load(0);
  }, [ready, signedIn, load]);

  const remove = async (video: VideoSummary) => {
    if (!window.confirm(`Remove "${displayTitle(video)}" from your library? Any share link for it will stop working.`)) return;
    try {
      const res = await apiFetch(`/api/videos/${video.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(await readError(res, "Could not remove the video."));
      setItems((prev) => prev.filter((v) => v.id !== video.id));
      setTotal((t) => Math.max(0, t - 1));
      onToast("Removed from your library.", "info");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not remove the video.", "error");
    }
  };

  if (!configured) {
    return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Sign-in is not configured for this app yet.</div>;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Your library</h1>
          <p className="text-sm text-[var(--text-muted)]">{total === 1 ? "1 video" : `${total} videos`}</p>
        </div>
        <Link href="/" className="whitespace-nowrap rounded-full bg-[var(--brand-lime)] px-5 py-2 text-sm font-black text-[#0E0F0C]">
          Summarize a video
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-12 text-center text-sm text-[var(--text-muted)]">
          <Video className="mx-auto mb-3 h-8 w-8" />
          <p className="font-semibold text-[var(--text-main)]">No videos yet</p>
          <p className="mt-1">Summarize your first video and it will appear here.</p>
        </div>
      )}

      <ul className="grid gap-3">
        {items.map((video) => (
          <li key={video.id} className="flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-sm">
            <Link href={`/video/${video.id}`} className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] rounded-lg">
              <p className="truncate text-sm font-bold sm:text-base">{displayTitle(video)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatAdded(video.added_at)}
                </span>
                {video.duration > 0 && <span>{formatDuration(video.duration)}</span>}
                <span>{video.source === "youtube" ? "YouTube" : "Upload"}</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-bold ${
                    video.status === "ready"
                      ? "bg-[var(--brand-lime)]/40 text-[var(--text-main)]"
                      : video.status === "failed"
                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  {statusLabel(video.status)}
                </span>
              </p>
            </Link>
            <button
              onClick={() => remove(video)}
              aria-label={`Remove ${displayTitle(video)}`}
              className="rounded-full p-2 text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)] hover:text-rose-600 cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {!loading && items.length < total && (
        <div className="mt-4 text-center">
          <button onClick={() => load(items.length)} className="rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-5 py-2 text-sm font-bold cursor-pointer">
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
