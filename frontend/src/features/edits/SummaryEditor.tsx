"use client";

import React, { useMemo, useState } from "react";
import { renderMarkdownWithMath } from "../../lib/mathUtils";
import { sanitizeHtml } from "../../lib/sanitize";
import { markActivity } from "../study/activity";
import { EditHistory } from "./EditHistory";
import { SaveIndicator } from "./SaveStatus";
import type { UseEdit } from "./useEdit";

export const MAX_SUMMARY_CHARS = 200_000;

interface Props {
  /** The AI summary, shown until you change something. */
  aiText: string;
  state: UseEdit<{ markdown: string }>;
  onDone: () => void;
  onToast: (msg: string, type?: "success" | "info" | "error") => void;
}

/** Markdown editor with a live preview, autosave, and version history. */
export function SummaryEditor({ aiText, state, onDone, onToast }: Props) {
  const text = state.edit?.markdown ?? aiText;
  const [preview, setPreview] = useState(true);
  const html = useMemo(() => sanitizeHtml(renderMarkdownWithMath(text)), [text]);

  const apply = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      onToast(message, "success");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Something went wrong.", "error");
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SaveIndicator status={state.status} conflict={state.conflict} />
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)]">
            <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
            Live preview
          </label>
          <EditHistory
            versions={state.versions}
            hasEdit={state.edit !== null}
            onRestore={(id) => apply(() => state.restore(id), "Version restored.")}
            onReset={() => apply(() => state.reset(), "Back to the AI version.")}
          />
          <button
            type="button"
            onClick={() => void state.flush().then(onDone)}
            className="rounded-full bg-[var(--brand-lime)] px-4 py-1.5 text-xs font-black text-[#0E0F0C] active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
          >
            Done
          </button>
        </div>
      </div>
      <div className={preview ? "grid gap-4 lg:grid-cols-2" : ""}>
        <div>
          <label htmlFor="summary-editor" className="sr-only">Edit the summary (Markdown)</label>
          <textarea
            id="summary-editor"
            value={text}
            maxLength={MAX_SUMMARY_CHARS}
            disabled={state.conflict}
            onChange={(e) => {
              markActivity();
              state.change({ markdown: e.target.value });
            }}
            className="min-h-[360px] w-full resize-y rounded-2xl border border-[var(--card-border)] bg-[var(--bg-app)] p-4 font-mono text-sm leading-relaxed text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Markdown and math ($…$) are supported. {text.length.toLocaleString()} / {MAX_SUMMARY_CHARS.toLocaleString()} characters.
          </p>
        </div>
        {preview && (
          <div
            aria-label="Preview"
            className="markdown-content min-h-[360px] overflow-auto rounded-2xl border border-[var(--card-border)] p-4 text-sm leading-relaxed text-[var(--text-main)]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
