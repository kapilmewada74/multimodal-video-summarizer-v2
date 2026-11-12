"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Download, Eye, Link2Off, Loader2, Pencil, Trash2, UploadCloud, X,
} from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import { uploadErrorMessage, uploadWithProgress } from "../../lib/upload";
import type { DocumentItem, StorageInfo, VideoSummary } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { DOCUMENT_ACCEPT, DOCUMENT_EXTENSIONS, formatBytes, storagePercent, validateFile } from "./files";
import { DocumentViewer, type ViewableFile } from "./DocumentViewer";
import { FileBadge } from "./FileBadge";

type Toast = (message: string, type?: "success" | "info" | "error") => void;

interface Props {
  /** Show and add documents of this video. Without it: all of your documents. */
  videoId?: string;
  onToast: Toast;
}

interface Pending {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

const small = "inline-flex items-center gap-1 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-2.5 py-1 text-xs font-bold hover:bg-[var(--btn-secondary-hover)] cursor-pointer disabled:opacity-50";

export function DocumentRow({ doc, videos, onOpen, onDownload, onRename, onDelete, onAttach, showAttach }: {
  doc: DocumentItem;
  videos: VideoSummary[];
  onOpen?: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAttach: (videoId: string | null) => void;
  showAttach: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 shadow-sm">
      <FileBadge extension={doc.extension} />
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-bold hover:underline cursor-pointer" title={doc.filename} aria-label={`Open ${doc.filename}`}>{doc.filename}</button>
        ) : (
          <p className="truncate text-sm font-bold" title={doc.filename}>{doc.filename}</p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-[var(--text-muted)]">
          <span>{formatBytes(doc.size_bytes)}</span>
          <span className="uppercase">{doc.extension}</span>
          {doc.has_text && <span title="The words in this file were read so they can be used for study tools later">Text read</span>}
          {doc.text_status === "failed" && <span>Could not read the text</span>}
        </p>
      </div>
      {showAttach && (
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className="sr-only">Attach {doc.filename} to a video</span>
          <select
            value={doc.video_id ?? ""}
            onChange={(e) => onAttach(e.target.value || null)}
            className="max-w-[12rem] rounded-lg border border-[var(--card-border)] bg-[var(--bg-app)] px-2 py-1 text-xs text-[var(--text-main)]"
          >
            <option value="">Not attached to a video</option>
            {videos.map((v) => <option key={v.id} value={v.id}>{v.title ?? "Untitled"}</option>)}
          </select>
        </label>
      )}
      <div className="flex items-center gap-1.5">
        {onOpen && <button className={small} onClick={onOpen} aria-label={`View ${doc.filename}`}><Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">View</span></button>}
        <button className={small} onClick={onDownload} aria-label={`Download ${doc.filename}`}><Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Download</span></button>
        <button className={small} onClick={onRename} aria-label={`Rename ${doc.filename}`}><Pencil className="h-3.5 w-3.5" /></button>
        {!showAttach && doc.video_id && (
          <button className={small} onClick={() => onAttach(null)} aria-label={`Detach ${doc.filename} from this video`} title="Keep the file, but not on this video"><Link2Off className="h-3.5 w-3.5" /></button>
        )}
        <button className={`${small} hover:text-rose-600`} onClick={onDelete} aria-label={`Delete ${doc.filename}`}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </li>
  );
}

/** Upload, list, download, rename, attach and delete documents. */
export function DocumentsManager({ videoId, onToast }: Props) {
  const { ready, signedIn } = useAuth();
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [filter, setFilter] = useState<"all" | "standalone">("all");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState<ViewableFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pageMode = !videoId;

  const load = useCallback(async () => {
    const query = videoId ? `video_id=${videoId}` : filter === "standalone" ? "standalone=true" : "";
    const res = await apiFetch(`/api/documents?limit=200${query ? `&${query}` : ""}`);
    if (!res.ok) return onToast(await readError(res, "Could not load your documents."), "error");
    const data = await res.json();
    setDocs(data.items);
    setStorage(data.storage);
  }, [videoId, filter, onToast]);

  useEffect(() => {
    if (ready && signedIn) void load();
  }, [ready, signedIn, load]);

  useEffect(() => {
    if (!pageMode || !ready || !signedIn) return;
    apiFetch("/api/videos?limit=100").then((r) => (r.ok ? r.json() : null)).then((d) => d && setVideos(d.items)).catch(() => undefined);
  }, [pageMode, ready, signedIn]);

  const uploadFiles = async (files: File[]) => {
    const maxBytes = storage?.max_document_bytes ?? 25 * 1024 * 1024;
    for (const file of files) {
      const problem = validateFile(file, DOCUMENT_EXTENSIONS, maxBytes);
      const key = `${file.name}-${file.size}-${Math.random()}`;
      if (problem) {
        onToast(problem, "error");
        continue;
      }
      setPending((p) => [...p, { key, name: file.name, progress: 0 }]);
      const form = new FormData();
      form.append("file", file);
      if (videoId) form.append("video_id", videoId);
      try {
        const result = await uploadWithProgress("/api/documents", form, (progress) =>
          setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))));
        if (result.status >= 200 && result.status < 300) {
          onToast(`Uploaded ${file.name}.`, "success");
          setPending((p) => p.filter((x) => x.key !== key));
        } else {
          const message = uploadErrorMessage(result);
          onToast(message, "error");
          setPending((p) => p.map((x) => (x.key === key ? { ...x, error: message } : x)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "The upload failed.";
        onToast(message, "error");
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error: message } : x)));
      }
      await load();
    }
  };

  const download = async (doc: DocumentItem) => {
    const res = await apiFetch(`/api/documents/${doc.id}/download-url`);
    if (!res.ok) return onToast(await readError(res, "Could not start the download."), "error");
    const { url } = await res.json();
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const patch = async (doc: DocumentItem, body: Record<string, unknown>, success?: string) => {
    const res = await apiFetch(`/api/documents/${doc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return onToast(await readError(res, "Could not change this document."), "error");
    if (success) onToast(success, "success");
    await load();
  };

  const rename = (doc: DocumentItem) => {
    const next = window.prompt("New name", doc.filename.replace(/\.[^.]+$/, ""));
    if (next && next.trim()) void patch(doc, { filename: next.trim() });
  };

  const remove = async (doc: DocumentItem) => {
    if (!window.confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return;
    const res = await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) {
      setDocs((prev) => prev?.filter((d) => d.id !== doc.id) ?? null);
      await load();
    } else onToast(await readError(res, "Could not delete this document."), "error");
  };

  const percent = storage ? storagePercent(storage.used_bytes, storage.quota_bytes) : 0;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-black tracking-tight">{pageMode ? "Your documents" : "Documents for this video"}</h3>
          <p className="text-xs text-[var(--text-muted)]">PDF, Word, PowerPoint, Excel, text, images and more. Up to {formatBytes(storage?.max_document_bytes ?? 25 * 1024 * 1024)} each.</p>
        </div>
        {pageMode && (
          <div role="tablist" aria-label="Filter documents" className="flex gap-1 rounded-full border border-[var(--card-border)] p-1">
            {(["all", "standalone"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-bold cursor-pointer ${filter === f ? "bg-[var(--brand-lime)] text-[#0E0F0C]" : "text-[var(--text-muted)]"}`}>
                {f === "all" ? "All" : "Not attached"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void uploadFiles(Array.from(e.dataTransfer.files)); }}
        className={`mb-4 flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center text-sm transition-colors ${dragOver ? "border-[var(--brand-lime)] bg-[var(--brand-lime)]/10" : "border-[var(--card-border)]"}`}
      >
        <UploadCloud className="h-7 w-7 text-[var(--text-muted)]" />
        <p>Drag files here, or</p>
        <button onClick={() => input.current?.click()} className="rounded-full bg-[var(--brand-lime)] px-4 py-2 text-sm font-black text-[#0E0F0C] cursor-pointer">Choose files</button>
        <input ref={input} type="file" multiple accept={DOCUMENT_ACCEPT} className="sr-only" aria-label="Choose documents to upload"
          onChange={(e) => { void uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {videoId && <p className="text-xs text-[var(--text-muted)]">They will be attached to this video.</p>}
      </div>

      {pending.length > 0 && (
        <ul className="mb-4 grid gap-2" aria-label="Uploads in progress">
          {pending.map((p) => (
            <li key={p.key} className="rounded-xl border border-[var(--card-border)] p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-bold">{p.name}</span>
                {p.error ? (
                  <button onClick={() => setPending((x) => x.filter((i) => i.key !== p.key))} aria-label={`Dismiss ${p.name}`}><X className="h-3.5 w-3.5" /></button>
                ) : <span>{Math.round(p.progress * 100)}%</span>}
              </div>
              {p.error ? <p className="mt-1 text-rose-600">{p.error}</p> : (
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span className="block h-full rounded-full bg-[var(--brand-lime)] transition-[width]" style={{ width: `${p.progress * 100}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {docs === null ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-muted)]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : docs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--card-border)] p-8 text-center text-sm text-[var(--text-muted)]">
          {pageMode && filter === "standalone" ? "Every document is attached to a video." : "No documents yet."}
        </p>
      ) : (
        <ul className="grid gap-2">
          {docs.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} videos={videos} showAttach={pageMode} onOpen={() => setViewing(doc)}
              onDownload={() => download(doc)} onRename={() => rename(doc)} onDelete={() => remove(doc)}
              onAttach={(vid) => patch(doc, { video_id: vid }, vid ? "Attached to the video." : "Detached from the video.")} />
          ))}
        </ul>
      )}

      {viewing && <DocumentViewer file={viewing} onClose={() => setViewing(null)} onToast={onToast} />}

      {storage && (
        <div className="mt-5 text-xs text-[var(--text-muted)]" aria-label="Storage used">
          <div className="mb-1 flex justify-between"><span>Storage used (documents and uploaded videos)</span><span>{formatBytes(storage.used_bytes)} of {formatBytes(storage.quota_bytes)}</span></div>
          <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <span className={`block h-full rounded-full ${percent > 90 ? "bg-rose-500" : "bg-[var(--brand-lime)]"}`} style={{ width: `${percent}%` }} />
          </span>
        </div>
      )}
    </div>
  );
}
