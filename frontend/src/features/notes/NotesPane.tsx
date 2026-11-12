"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, CloudOff, Loader2 } from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import { markActivity } from "../study/activity";
import { Autosaver, type SaveStatus } from "./autosave";

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: "",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved",
  error: "Could not save. Your text is kept; it will retry when you type again.",
};

/** Your own notes for this video. Saved automatically a moment after you stop typing. */
export function NotesPane({ videoId }: { videoId: string }) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const saver = useRef<Autosaver | null>(null);

  const instance = useMemo(
    () =>
      new Autosaver({
        onStatus: setStatus,
        save: async (content) => {
          const res = await apiFetch(`/api/videos/${videoId}/notes`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content }),
            keepalive: content.length < 60_000, // lets a last save finish while the page closes
          });
          if (!res.ok) throw new Error(await readError(res));
        },
      }),
    [videoId],
  );

  useEffect(() => {
    saver.current = instance;
    let cancelled = false;
    setLoaded(false);
    apiFetch(`/api/videos/${videoId}/notes`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, "Could not load your notes."));
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        instance.setBaseline(data.content);
        setText(data.content);
        setLoaded(true);
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Could not load your notes."));

    const onHide = () => void instance.flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onHide);
      void instance.flush(); // leaving this tab or page: do not lose the last words
      instance.dispose();
    };
  }, [videoId, instance]);

  if (loadError) {
    return <div role="alert" className="py-10 text-center text-sm">{loadError}</div>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xl font-black tracking-tight text-[var(--text-main)]">My notes</h3>
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]" aria-live="polite">
          {status === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {status === "saved" && <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />}
          {status === "error" && <CloudOff className="h-3.5 w-3.5 text-[var(--color-danger)]" />}
          {STATUS_TEXT[status]}
        </span>
      </div>
      <label htmlFor={`notes-${videoId}`} className="sr-only">Your notes for this video</label>
      <textarea
        id={`notes-${videoId}`}
        value={text}
        disabled={!loaded}
        maxLength={200000}
        placeholder={loaded ? "Write your own notes here. They are private and saved automatically." : "Loading your notes…"}
        onChange={(e) => {
          setText(e.target.value);
          markActivity(); // typing counts as studying
          saver.current?.change(e.target.value);
        }}
        className="min-h-[320px] w-full resize-y rounded-2xl border border-[var(--card-border)] bg-[var(--bg-app)] p-4 text-sm leading-relaxed text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
      />
      <p className="mt-2 text-xs text-[var(--text-muted)]">{text.length.toLocaleString()} / 200,000 characters</p>
    </div>
  );
}
