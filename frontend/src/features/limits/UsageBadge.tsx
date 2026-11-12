"use client";

import React, { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { formatReset, formatUsage, type Usage } from "./usage";

/** "7 of 10 videos today". Pass a new `refreshKey` to reload after a submission. */
export function UsageBadge({ refreshKey }: { refreshKey: number }) {
  const { ready, signedIn } = useAuth();
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    if (!ready || !signedIn) return;
    let cancelled = false;
    apiFetch("/api/me/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setUsage(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready, signedIn, refreshKey]);

  if (!usage) return null;
  const exhausted = usage.remaining <= 0;
  return (
    <div className="flex justify-center mb-4" aria-live="polite">
      <span
        className={`px-3 py-1 rounded-full text-xs font-bold border ${
          exhausted
            ? "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300"
            : "bg-[var(--btn-secondary-bg)] border-[var(--card-border)] text-[var(--text-muted)]"
        }`}
        title={formatReset(usage.resets_at)}
      >
        {formatUsage(usage)}
        {exhausted ? ` · ${formatReset(usage.resets_at)}` : ""}
      </span>
    </div>
  );
}
