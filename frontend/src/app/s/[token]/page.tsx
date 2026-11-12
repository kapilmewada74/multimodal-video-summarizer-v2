"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { MathText } from "../../../components/MathText";
import { Navbar } from "../../../components/Navbar";
import { VideoPlayer } from "../../../features/workspace/VideoPlayer";
import { MindMapView } from "../../../features/workspace/MindMapView";
import { apiFetch } from "../../../lib/api";
import { renderMarkdownWithMath } from "../../../lib/mathUtils";
import type { PublicVideo } from "../../../lib/types";
import { useTheme } from "../../../lib/useTheme";

/** The read-only page a share link opens. No sign-in is needed (or started). */
export default function SharedPage() {
  const params = useParams<{ token: string }>();
  const { theme, toggleTheme } = useTheme();
  const [video, setVideo] = useState<PublicVideo | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/public/${encodeURIComponent(params.token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState("missing");
          return;
        }
        setVideo(await res.json());
        setState("ready");
      })
      .catch(() => !cancelled && setState("missing"));
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  // renderMarkdownWithMath sanitizes the HTML before it is shown.
  const summaryHtml = useMemo(() => (video ? renderMarkdownWithMath(video.summary) : ""), [video]);

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-3xl px-3 py-8 sm:px-6">
        {state === "loading" && (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--text-muted)]" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {state === "missing" && (
          <div role="alert" className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-10 text-center">
            <h1 className="text-xl font-black">This link is not available</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">It may have been turned off by its owner, or the address is wrong.</p>
            <Link href="/" className="mt-5 inline-block rounded-full bg-[var(--brand-lime)] px-5 py-2 text-sm font-black text-[#0E0F0C]">
              Make your own study notes
            </Link>
          </div>
        )}

        {state === "ready" && video && (
          <article>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{video.title || "Shared video"}</h1>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Shared study notes · read only</p>

            <div className="mt-5">
              <VideoPlayer youtubeId={video.youtube_id} title={video.title} />
            </div>

            <section className="mt-8 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-xl sm:p-8">
              <h2 className="mb-4 text-xl font-black">Summary</h2>
              <div className="markdown-content text-sm sm:text-base leading-relaxed" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
            </section>

            {video.mindmap && (
              <section className="mt-6 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-xl sm:p-8">
                <MindMapView data={video.mindmap} />
              </section>
            )}

            {video.flashcards && video.flashcards.length > 0 && (
              <section className="mt-6 rounded-[18px] border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-xl sm:p-8">
                <h2 className="mb-4 text-xl font-black">Flashcards</h2>
                <ol className="grid gap-3">
                  {video.flashcards.map((card, index) => (
                    <li key={index} className="rounded-xl border border-[var(--card-border)] p-4">
                      <p className="font-bold"><MathText text={card.front} /></p>
                      <p className="mt-1 text-sm text-[var(--text-muted)]"><MathText text={card.back} /></p>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <div className="mt-10 text-center">
              <Link href="/" className="inline-block rounded-full bg-[var(--brand-lime)] px-6 py-2.5 text-sm font-black text-[#0E0F0C]">
                Make your own study notes
              </Link>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
