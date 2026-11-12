"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, readError } from "../../lib/api";
import { Autosaver, type SaveStatus } from "../notes/autosave";

export type EditKind = "summary" | "slides";

export interface EditVersion {
  id: string;
  created_at: string;
}

interface ServerEdit<T> {
  content: T | null;
  updated_at: string | null;
  versions: EditVersion[];
}

export interface UseEdit<T> {
  /** Your edited copy, or null while you are using the AI version. */
  edit: T | null;
  loaded: boolean;
  loadError: string | null;
  status: SaveStatus;
  /** Another tab saved newer text; nothing more is saved from here until you reload. */
  conflict: boolean;
  versions: EditVersion[];
  /** Call on every change. The text is saved a moment after you stop. */
  change: (content: T) => void;
  flush: () => Promise<void>;
  peek: (versionId: string) => Promise<T>;
  restore: (versionId: string) => Promise<T>;
  /** Go back to the AI version (your edit stays in the history). */
  reset: () => Promise<void>;
}

/**
 * Loads and autosaves the user's own edited copy of a video's summary or slides.
 * `aiContent` is what the editor starts from when there is no edit yet; changing
 * nothing never creates an edit.
 */
export function useEdit<T>(videoId: string | null | undefined, kind: EditKind, aiContent: T): UseEdit<T> {
  const [edit, setEdit] = useState<T | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [conflict, setConflict] = useState(false);
  const [versions, setVersions] = useState<EditVersion[]>([]);
  const updatedAt = useRef<string | null>(null);
  const aiRef = useRef(aiContent);
  aiRef.current = aiContent;
  const base = `/api/videos/${videoId}/edits/${kind}`;

  const reload = useCallback(async (): Promise<ServerEdit<T>> => {
    const res = await apiFetch(base);
    if (!res.ok) throw new Error(await readError(res, "Could not load your edits."));
    return (await res.json()) as ServerEdit<T>;
  }, [base]);

  const saver = useMemo(
    () =>
      new Autosaver({
        delayMs: 1500,
        onStatus: setStatus,
        save: async (json) => {
          const res = await apiFetch(base, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: JSON.parse(json), base_updated_at: updatedAt.current }),
            keepalive: json.length < 60_000,
          });
          if (res.status === 409) {
            setConflict(true);
            throw new Error("conflict");
          }
          if (!res.ok) throw new Error(await readError(res));
          const body = await res.json();
          updatedAt.current = body.updated_at;
          if (body.changed) {
            const fresh = await reload().catch(() => null);
            if (fresh) setVersions(fresh.versions);
          }
        },
      }),
    [base, reload],
  );

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    setConflict(false);
    reload()
      .then((data) => {
        if (cancelled) return;
        updatedAt.current = data.updated_at;
        setEdit(data.content);
        setVersions(data.versions);
        saver.setBaseline(JSON.stringify(data.content ?? aiRef.current));
        setLoaded(true);
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Could not load your edits."));
    const onHide = () => void saver.flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onHide);
      void saver.flush();
      saver.dispose();
    };
  }, [videoId, reload, saver]);

  const change = useCallback(
    (content: T) => {
      if (conflict) return;
      setEdit(content);
      saver.change(JSON.stringify(content));
    },
    [saver, conflict],
  );

  const peek = useCallback(
    async (versionId: string) => {
      const res = await apiFetch(`${base}/versions/${versionId}`);
      if (!res.ok) throw new Error(await readError(res, "Could not open that version."));
      return ((await res.json()) as { content: T }).content;
    },
    [base],
  );

  const restore = useCallback(
    async (versionId: string) => {
      await saver.flush();
      const res = await apiFetch(`${base}/versions/${versionId}/restore`, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res, "Could not restore that version."));
      const body = (await res.json()) as { content: T; updated_at: string };
      updatedAt.current = body.updated_at;
      saver.setBaseline(JSON.stringify(body.content));
      setEdit(body.content);
      setConflict(false);
      setStatus("saved");
      setVersions((await reload()).versions);
      return body.content;
    },
    [base, saver, reload],
  );

  const reset = useCallback(async () => {
    await saver.flush();
    const res = await apiFetch(base, { method: "DELETE" });
    if (!res.ok) throw new Error(await readError(res, "Could not go back to the AI version."));
    updatedAt.current = null;
    saver.setBaseline(JSON.stringify(aiRef.current));
    setEdit(null);
    setConflict(false);
    setStatus("idle");
    setVersions((await reload()).versions);
  }, [base, saver, reload]);

  return { edit, loaded, loadError, status, conflict, versions, change, flush: () => saver.flush(), peek, restore, reset };
}
