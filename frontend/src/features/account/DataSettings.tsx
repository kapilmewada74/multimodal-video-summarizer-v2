"use client";

import React, { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";

type Toast = (message: string, type?: "success" | "info" | "error") => void;

/** Download a copy of everything we hold, or delete the account for good. */
export function DataSettings({ onToast }: { onToast: Toast }) {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");

  const download = async () => {
    setBusy("export");
    try {
      const res = await apiFetch("/api/me/export");
      if (!res.ok) throw new Error(await readError(res, "Could not prepare your data."));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not prepare your data.", "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      const res = await apiFetch("/api/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: typed }) });
      if (!res.ok) throw new Error(await readError(res, "Could not delete your account."));
      await signOut();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not delete your account.", "error");
      setBusy(null);
    }
  };

  const button = "flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-4 py-2 text-sm font-bold cursor-pointer disabled:opacity-50";
  return (
    <section aria-labelledby="your-data" className="mt-8 rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-6">
      <h2 id="your-data" className="text-lg font-black tracking-tight">Your data</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">You own your study material. Take a copy, or remove everything.</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={download} disabled={busy !== null} className={button}>
          {busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download my data
        </button>
        {!confirming && (
          <button onClick={() => setConfirming(true)} className={`${button} !border-red-500/40 text-red-600 dark:text-red-400`}>
            <Trash2 className="h-4 w-4" /> Delete my account
          </button>
        )}
      </div>

      {confirming && (
        <div role="alertdialog" aria-label="Confirm account deletion" className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
          <p className="text-sm font-semibold">This permanently deletes your account, summaries, notes, playlists, study history and uploaded files. It cannot be undone.</p>
          <label className="mt-3 block text-xs font-bold" htmlFor="confirm-delete">Type DELETE to confirm</label>
          <input id="confirm-delete" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
            className="mt-1 w-full max-w-xs rounded-lg border border-[var(--card-border)] bg-[var(--bg-app)] px-3 py-2 text-sm" />
          <div className="mt-3 flex gap-3">
            <button onClick={remove} disabled={typed !== "DELETE" || busy !== null}
              className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white cursor-pointer disabled:opacity-40">
              {busy === "delete" && <Loader2 className="h-4 w-4 animate-spin" />} Delete everything
            </button>
            <button onClick={() => { setConfirming(false); setTyped(""); }} className={button}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
