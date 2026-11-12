"use client";

import React, { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { apiFetch } from "../../lib/api";
import type { DocumentItem } from "../../lib/types";

/** How many of the user's documents on this video have readable text the AI could use. */
export function useUsableDocumentCount(videoId: string | null | undefined, refreshKey: unknown): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    apiFetch(`/api/documents?video_id=${videoId}&limit=100`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setCount((data.items as DocumentItem[]).filter((d) => d.has_text).length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [videoId, refreshKey]);
  return count;
}

interface Props {
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Files the current result was made from. */
  used?: string[];
}

/** "Also use my documents" switch for flashcards, quiz, mind map and slides. */
export function DocumentContextToggle({ count, checked, onChange, used }: Props) {
  if (count === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-4 py-2.5 text-xs">
      <label className="flex cursor-pointer items-center gap-2 font-bold text-[var(--text-main)]">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <FileText className="h-3.5 w-3.5" />
        Also use my documents ({count})
      </label>
      <span className="text-[var(--text-muted)]">
        {checked
          ? used && used.length > 0
            ? `Made using: ${used.join(", ")}. Only you can see this version.`
            : "Made from the video and your documents. Only you can see this version."
          : "Off: made from the video only, and shared with everyone who has it."}
      </span>
    </div>
  );
}
