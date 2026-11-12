"use client";

import React, { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import type { EditVersion } from "./useEdit";

export function formatVersionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Props {
  versions: EditVersion[];
  hasEdit: boolean;
  onRestore: (id: string) => Promise<void>;
  onReset: () => Promise<void>;
  /** Short description of what a version holds, for the list. */
  disabled?: boolean;
}

/** Version list plus "Back to AI version". */
export function EditHistory({ versions, hasEdit, onRestore, onReset, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3.5 py-1.5 text-xs font-bold text-[var(--btn-secondary-text)] hover:bg-[var(--btn-secondary-hover)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
      >
        <History className="h-3.5 w-3.5" />
        History{versions.length ? ` (${versions.length})` : ""}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-card)] p-2 shadow-lg"
        >
          {hasEdit && (
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={() => void run(onReset)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)] disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Back to the AI version
            </button>
          )}
          {versions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">Earlier versions will appear here as you edit.</p>
          ) : (
            <ul className="max-h-60 overflow-y-auto">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => void run(() => onRestore(v.id))}
                    className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)] disabled:opacity-50"
                  >
                    <span>{formatVersionTime(v.created_at)}</span>
                    <span className="font-bold text-[var(--text-muted)]">Restore</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
