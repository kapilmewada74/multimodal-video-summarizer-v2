"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ListVideo, Loader2, Plus, Trash2 } from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import type { PlaylistSummary } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";

type Toast = (message: string, type?: "success" | "info" | "error") => void;
const field = "min-w-0 flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-app)] px-3 py-2 text-sm";
const primary = "rounded-full bg-[var(--brand-lime)] px-4 py-2 text-sm font-black text-[#0E0F0C] disabled:opacity-60 cursor-pointer";

export function PlaylistList({ onToast }: { onToast: Toast }) {
  const { ready, signedIn, configured } = useAuth();
  const [items, setItems] = useState<PlaylistSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [busy, setBusy] = useState<"create" | "import" | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/playlists");
    if (res.ok) setItems((await res.json()).items);
    else onToast(await readError(res, "Could not load your playlists."), "error");
  }, [onToast]);

  useEffect(() => {
    if (ready && signedIn) void load();
  }, [ready, signedIn, load]);

  const post = async (kind: "create" | "import", url: string, body: unknown, success: string) => {
    setBusy(kind);
    try {
      const res = await apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res));
      onToast(success, "success");
      await load();
      return true;
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Something went wrong.", "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: PlaylistSummary) => {
    if (!window.confirm(`Delete the playlist "${p.title}"? Your videos and notes are not deleted.`)) return;
    const res = await apiFetch(`/api/playlists/${p.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) setItems((prev) => prev?.filter((x) => x.id !== p.id) ?? null);
    else onToast(await readError(res, "Could not delete the playlist."), "error");
  };

  if (!configured) return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Sign-in is not configured for this app yet.</div>;

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-black tracking-tight">Playlists</h1>

      <section className="grid gap-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:grid-cols-2" aria-label="Create a playlist">
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (title.trim() && (await post("create", "/api/playlists", { title }, "Playlist created."))) setTitle("");
          }}
        >
          <label htmlFor="new-playlist" className="text-xs font-bold">New playlist</label>
          <div className="flex gap-2">
            <input id="new-playlist" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Physics course" className={field} />
            <button className={primary} disabled={busy !== null || !title.trim()}><Plus className="h-4 w-4" /></button>
          </div>
        </form>
        <form
          className="grid gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (importUrl.trim() && (await post("import", "/api/playlists/import-youtube", { url: importUrl }, "Playlist imported."))) setImportUrl("");
          }}
        >
          <label htmlFor="import-playlist" className="text-xs font-bold">Import a YouTube playlist</label>
          <div className="flex gap-2">
            <input id="import-playlist" value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=…" className={field} />
            <button className={primary} disabled={busy !== null || !importUrl.trim()}>{busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}</button>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Importing does not summarize anything, so it does not use your daily videos.</p>
        </form>
      </section>

      {items === null ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--text-muted)]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-12 text-center text-sm text-[var(--text-muted)]">
          <ListVideo className="mx-auto mb-3 h-8 w-8" />
          <p className="font-semibold text-[var(--text-main)]">No playlists yet</p>
          <p className="mt-1">Create one above, or import a YouTube playlist to study it in order.</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-sm">
              <Link href={`/playlists/${p.id}`} className="min-w-0 flex-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]">
                <p className="truncate font-bold">{p.title}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {p.item_count} video{p.item_count === 1 ? "" : "s"} · {p.completed_count} finished{p.source === "youtube" ? " · from YouTube" : ""}
                </p>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]">
                  <span className="block h-full rounded-full bg-[var(--brand-lime)]" style={{ width: `${p.item_count ? Math.round((100 * p.completed_count) / p.item_count) : 0}%` }} />
                </span>
              </Link>
              <button onClick={() => remove(p)} aria-label={`Delete ${p.title}`} className="rounded-full p-2 text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)] hover:text-rose-600 cursor-pointer">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
