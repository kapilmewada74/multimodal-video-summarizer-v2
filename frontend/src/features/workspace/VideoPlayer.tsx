"use client";

import React from "react";
import { isYouTubeId, youtubeEmbedUrl } from "./share";

/** The official YouTube player for YouTube videos. Uploaded files are not kept after processing. */
export function VideoPlayer({ youtubeId, title }: { youtubeId: string | null; title: string | null }) {
  if (!isYouTubeId(youtubeId)) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center text-sm text-[var(--text-muted)]">
        This video was uploaded as a file, so there is no preview. Your notes are below.
      </div>
    );
  }
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-[var(--card-border)] bg-black shadow-xl" style={{ aspectRatio: "16 / 9" }}>
      <iframe
        src={youtubeEmbedUrl(youtubeId)}
        title={title ? `Video: ${title}` : "Video player"}
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}
