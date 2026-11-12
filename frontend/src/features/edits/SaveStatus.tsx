import React from "react";
import { Check, CloudOff, Loader2 } from "lucide-react";
import type { SaveStatus } from "../notes/autosave";

const TEXT: Record<SaveStatus, string> = {
  idle: "",
  dirty: "Unsaved changes…",
  saving: "Saving…",
  saved: "Saved",
  error: "Could not save. Your changes are kept and will retry.",
};

export function SaveIndicator({ status, conflict }: { status: SaveStatus; conflict?: boolean }) {
  if (conflict) {
    return (
      <span role="alert" className="text-xs font-bold text-[var(--color-danger)]">
        Changed in another tab. Reload this page to see the latest.
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]" aria-live="polite">
      {status === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {status === "saved" && <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />}
      {status === "error" && <CloudOff className="h-3.5 w-3.5 text-[var(--color-danger)]" />}
      {TEXT[status]}
    </span>
  );
}
