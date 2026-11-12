"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, CheckCircle2, Download, Eye, FilePlus2, GripVertical, Loader2, Play, Trash2, UploadCloud, X } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton";
import { apiFetch, readError } from "../../lib/api";
import { uploadErrorMessage, uploadWithProgress } from "../../lib/upload";
import { UploadedVideoPlayer } from "../player/UploadedVideoPlayer";
import { DOCUMENT_ACCEPT, validateFile, VIDEO_ACCEPT, VIDEO_EXTENSIONS } from "../documents/files";
import { downloadDocument, dragHasFiles, uploadDocuments, type UploadProgress } from "../documents/api";
import { DocumentViewer, type ViewableFile } from "../documents/DocumentViewer";
import { FileBadge } from "../documents/FileBadge";
import { useLessonUpload } from "../documents/useLessonUpload";
import { LessonFiles } from "./LessonFiles";
import type { PlaylistDetail as Detail, PlaylistItem, VideoSummary } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { formatDuration } from "../library/format";
import { formatBytes } from "../documents/files";
import { arrayMove, neighboursAfterMove } from "./reorder";

type Toast = (message: string, type?: "success" | "info" | "error") => void;
const field = "min-w-0 flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--bg-app)] px-3 py-2 text-sm";
const primary = "rounded-full bg-[var(--brand-lime)] px-4 py-2 text-sm font-black text-[#0E0F0C] disabled:opacity-60 cursor-pointer";

function statusText(item: PlaylistItem): string {
  if (item.completed) return "Finished";
  if (item.status === "uploaded") return "Uploaded from your device · not summarized yet";
  if (item.status === "ready") return item.progress_seconds > 0 ? `${item.percent}% watched` : "Ready";
  if (item.status === "failed") return "Failed";
  if (item.status === "pending" || item.status === "processing") return "Processing…";
  return "Not summarized yet";
}

interface RowShared {
  onOpenFile: (file: { id: string; filename: string; extension: string; size_bytes: number }) => void;
  onChanged: () => Promise<void>;
  onToast: Toast;
}

/** A video in the playlist. On its right: the files that belong to it, play/open/summarize, remove. */
function Row({ item, onRemove, onSummarize, summarizing, onOpenFile, onChanged, onToast }: RowShared & {
  item: PlaylistItem; onRemove: () => void; onSummarize: () => void; summarizing: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [playing, setPlaying] = useState(false);
  const [dropping, setDropping] = useState(false);
  const lesson = useLessonUpload(item.id, onChanged, onToast);
  const style = { transform: CSS.Transform.toString(transform), transition };
  const openable = item.video_id && item.status === "ready";
  const device = item.kind === "device_upload" && item.upload_id;
  const canSummarize = (!item.status && item.youtube_id) || (device && (item.status === "uploaded" || item.status === "failed"));
  return (
    <li
      ref={setNodeRef}
      style={style}
      onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); e.stopPropagation(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        void lesson.upload(Array.from(e.dataTransfer.files));
      }}
      className={`flex flex-wrap items-center gap-3 rounded-2xl border bg-[var(--card-bg)] p-3 shadow-sm ${
        dropping ? "border-[var(--brand-lime)] ring-2 ring-[var(--brand-lime)]/40" : "border-[var(--card-border)]"
      } ${isDragging ? "z-10 opacity-80 shadow-xl" : ""}`}
    >
      <button {...attributes} {...listeners} aria-label={`Drag to reorder ${item.title}`} className="cursor-grab touch-none rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)] active:cursor-grabbing">
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1 basis-40">
        {openable ? (
          <Link href={`/video/${item.video_id}`} className="block break-words text-sm font-bold hover:underline line-clamp-2 sm:truncate">{item.title}</Link>
        ) : (
          <p className="break-words text-sm font-bold line-clamp-2 sm:truncate">{item.title}</p>
        )}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-[var(--text-muted)]">
          {item.duration > 0 && <span>{formatDuration(item.duration)}</span>}
          {device && item.size_bytes ? <span>{formatBytes(item.size_bytes)}</span> : null}
          <span className="inline-flex items-center gap-1">{item.completed && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--color-success)]" />}{statusText(item)}</span>
        </p>
        {item.status === "ready" && (
          <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-valuenow={item.completed ? 100 : item.percent} aria-valuemin={0} aria-valuemax={100}>
            <span className="block h-full rounded-full bg-[var(--brand-lime)]" style={{ width: `${item.completed ? 100 : item.percent}%` }} />
          </span>
        )}
      </div>
      {/* On a phone the actions drop to their own line instead of squeezing the title. */}
      <div className="flex basis-full items-center justify-end gap-2 sm:basis-auto">
        <LessonFiles
          title={item.title}
          files={item.documents ?? []}
          pending={lesson.pending}
          onUpload={lesson.upload}
          onDismiss={lesson.dismiss}
          onOpen={onOpenFile}
          onChanged={onChanged}
          onToast={onToast}
        />
        {device && (
          <button onClick={() => setPlaying((v) => !v)} aria-pressed={playing} aria-label={`${playing ? "Close" : "Play"} ${item.title}`}
            className="inline-flex h-9 items-center gap-1 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 text-xs font-bold cursor-pointer">
            {playing ? <X className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {playing ? "Close" : "Play"}
          </button>
        )}
        {openable && <Link href={`/video/${item.video_id}`} className="inline-flex h-9 items-center rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 text-xs font-bold">Open</Link>}
        {canSummarize && (
          <button onClick={onSummarize} disabled={summarizing} className="h-9 rounded-full bg-[var(--brand-lime)] px-3 text-xs font-black text-[#0E0F0C] disabled:opacity-60 cursor-pointer">
            {summarizing ? "Starting…" : item.status === "failed" ? "Try again" : "Summarize"}
          </button>
        )}
        <IconButton label={`Remove ${item.title}`} tone="danger" onClick={onRemove}><Trash2 className="h-4 w-4" /></IconButton>
      </div>
      {device && playing && (
        <div className="basis-full">
          <div className="mx-auto max-w-2xl"><UploadedVideoPlayer uploadId={item.upload_id as string} title={item.title} /></div>
        </div>
      )}
    </li>
  );
}

/** A file that sits in the list like a video: ordered by dragging, opened in the page. */
function DocRow({ item, onRemove, onOpenFile, onToast }: Pick<RowShared, "onOpenFile" | "onToast"> & { item: PlaylistItem; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const file = item.document;
  if (!file) return null;
  return (
    <li ref={setNodeRef} style={style} className={`flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3 shadow-sm ${isDragging ? "z-10 opacity-80 shadow-xl" : ""}`}>
      <button {...attributes} {...listeners} aria-label={`Drag to reorder ${file.filename}`} className="cursor-grab touch-none rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)] active:cursor-grabbing">
        <GripVertical className="h-5 w-5" />
      </button>
      <FileBadge extension={file.extension} />
      <button type="button" onClick={() => onOpenFile(file)} className="min-w-0 flex-1 basis-40 text-left cursor-pointer" aria-label={`Open ${file.filename}`}>
        <span className="block break-words text-sm font-bold line-clamp-2 hover:underline sm:truncate">{file.filename}</span>
        <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{formatBytes(file.size_bytes)} · {file.extension.toUpperCase()}{file.has_text ? " · text read" : ""}</span>
      </button>
      <div className="flex basis-full items-center justify-end gap-2 sm:basis-auto">
        <button onClick={() => onOpenFile(file)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 text-xs font-bold cursor-pointer hover:bg-[var(--btn-secondary-hover)]">
          <Eye className="h-3.5 w-3.5" /> Open
        </button>
        <IconButton label={`Download ${file.filename}`} onClick={() => void downloadDocument(file).catch(() => onToast("Could not start the download.", "error"))}>
          <Download className="h-4 w-4" />
        </IconButton>
        <IconButton label={`Remove ${file.filename}`} tone="danger" onClick={onRemove}><Trash2 className="h-4 w-4" /></IconButton>
      </div>
    </li>
  );
}

export function PlaylistDetail({ playlistId, onToast }: { playlistId: string; onToast: Toast }) {
  const { ready, signedIn, configured } = useAuth();
  const [playlist, setPlaylist] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [libraryChoice, setLibraryChoice] = useState("");
  const [library, setLibrary] = useState<VideoSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [summarizing, setSummarizing] = useState<string | null>(null);
  const [uploads, setUploads] = useState<{ key: string; name: string; progress: number; error?: string }[]>([]);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const docInput = React.useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<ViewableFile | null>(null);
  const [docUploads, setDocUploads] = useState<UploadProgress[]>([]);
  const [listDrop, setListDrop] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/playlists/${playlistId}`);
      if (!res.ok) throw new Error(res.status === 404 ? "We could not find this playlist." : await readError(res));
      setPlaylist(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this playlist.");
    }
  }, [playlistId]);

  useEffect(() => {
    if (!ready || !signedIn) return;
    void load();
    apiFetch("/api/videos?limit=100").then((r) => (r.ok ? r.json() : null)).then((d) => d && setLibrary(d.items.filter((v: VideoSummary) => v.status === "ready"))).catch(() => undefined);
  }, [ready, signedIn, load]);

  // While a video from the list is being processed, check back now and then.
  const processing = playlist?.items.some((i) => i.status === "pending" || i.status === "processing") ?? false;
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [processing, load]);

  const onDragEnd = async (event: DragEndEvent) => {
    if (!playlist || !event.over || event.active.id === event.over.id) return;
    const ids = playlist.items.map((i) => i.id);
    const from = ids.indexOf(String(event.active.id));
    const to = ids.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    const { after, before } = neighboursAfterMove(ids, from, to);
    const previous = playlist;
    setPlaylist({ ...playlist, items: arrayMove(playlist.items, from, to) }); // move instantly; the server confirms
    const res = await apiFetch(`/api/playlists/${playlistId}/items/${event.active.id}/move`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ after_id: after, before_id: before }),
    });
    if (!res.ok) {
      setPlaylist(previous);
      onToast(await readError(res, "Could not move that video."), "error");
      void load();
    }
  };

  const add = async (body: { url?: string; video_id?: string }) => {
    setAdding(true);
    try {
      const res = await apiFetch(`/api/playlists/${playlistId}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res));
      setUrl("");
      setLibraryChoice("");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not add the video.", "error");
    } finally {
      setAdding(false);
    }
  };

  const uploadVideos = async (files: File[]) => {
    for (const file of files) {
      const problem = validateFile(file, VIDEO_EXTENSIONS, 500 * 1024 * 1024);
      if (problem) {
        onToast(problem, "error");
        continue;
      }
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      const form = new FormData();
      form.append("file", file);
      try {
        const result = await uploadWithProgress(`/api/playlists/${playlistId}/uploads`, form, (progress) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress } : x))));
        if (result.status >= 200 && result.status < 300) {
          setUploads((u) => u.filter((x) => x.key !== key));
          onToast(`Uploaded ${file.name}.`, "success");
        } else {
          const message = uploadErrorMessage(result);
          onToast(message, "error");
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: message } : x)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "The upload failed.";
        onToast(message, "error");
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: message } : x)));
      }
      await load();
    }
  };

  /** Files added as rows of their own, ordered with the videos. */
  const addDocuments = async (files: File[]) => {
    const stored = await uploadDocuments({
      files, endpoint: `/api/playlists/${playlistId}/documents`, maxBytes: 25 * 1024 * 1024,
      onProgress: (update) => setDocUploads(update), onToast,
    });
    if (stored > 0) {
      onToast(stored === 1 ? "File added to the list." : `${stored} files added to the list.`, "success");
      await load();
    }
  };

  const remove = async (item: PlaylistItem) => {
    if (item.kind === "document" && !window.confirm(`Remove "${item.title}" and delete the file? This cannot be undone.`)) return;
    const res = await apiFetch(`/api/playlists/${playlistId}/items/${item.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) setPlaylist((p) => (p ? { ...p, items: p.items.filter((i) => i.id !== item.id) } : p));
    else onToast(await readError(res, "Could not remove it."), "error");
  };

  const summarize = async (item: PlaylistItem) => {
    if (!item.youtube_id && !item.upload_id) return;
    setSummarizing(item.id);
    try {
      const res = item.upload_id
        ? await apiFetch(`/api/uploads/${item.upload_id}/summarize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        : await apiFetch("/api/summarize/url", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${item.youtube_id}` }),
          });
      if (!res.ok) throw new Error(await readError(res));
      onToast("Started. This video will be ready in a moment.", "success");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not start the summary.", "error");
    } finally {
      setSummarizing(null);
    }
  };

  const back = <Link href="/playlists" className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]"><ArrowLeft className="h-4 w-4" /> Playlists</Link>;
  if (!configured) return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Sign-in is not configured for this app yet.</div>;
  if (error) return <div>{back}<div role="alert" className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-sm">{error}</div></div>;
  if (!playlist) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--text-muted)]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const inList = new Set(playlist.items.map((i) => i.video_id).filter(Boolean));
  const choices = library.filter((v) => !inList.has(v.id));

  return (
    <div>
      {back}
      <h1 className="break-words text-2xl font-black tracking-tight">{playlist.title}</h1>
      <p className="mb-5 mt-1 text-sm text-[var(--text-muted)]">
        {playlist.item_count} item{playlist.item_count === 1 ? "" : "s"} · {playlist.completed_count} finished. Drag the handle to change the order. Drop files on a video to attach them to it.
      </p>

      <section className="mb-5 grid gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:grid-cols-2" aria-label="Add videos">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void add({ url }); }}>
          <label htmlFor="add-url" className="sr-only">YouTube link</label>
          <input id="add-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a YouTube link" className={field} />
          <button className={primary} disabled={adding || !url.trim()}>Add</button>
        </form>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (libraryChoice) void add({ video_id: libraryChoice }); }}>
          <label htmlFor="add-library" className="sr-only">Add from your library</label>
          <select id="add-library" value={libraryChoice} onChange={(e) => setLibraryChoice(e.target.value)} className={field}>
            <option value="">Add from your library…</option>
            {choices.map((v) => <option key={v.id} value={v.id}>{v.title ?? "Untitled"}</option>)}
          </select>
          <button className={primary} disabled={adding || !libraryChoice}>Add</button>
        </form>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-4 py-2 text-sm font-bold cursor-pointer hover:bg-[var(--btn-secondary-hover)] sm:w-auto">
            <UploadCloud className="h-4 w-4" /> Upload a video from your device
          </button>
          <input ref={fileInput} type="file" multiple accept={VIDEO_ACCEPT} className="sr-only" aria-label="Choose videos to upload"
            onChange={(e) => { void uploadVideos(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <button type="button" onClick={() => docInput.current?.click()} className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-4 py-2 text-sm font-bold cursor-pointer hover:bg-[var(--btn-secondary-hover)] sm:w-auto">
            <FilePlus2 className="h-4 w-4" /> Add a document
          </button>
          <input ref={docInput} type="file" multiple accept={DOCUMENT_ACCEPT} className="sr-only" aria-label="Choose documents to add to the list"
            onChange={(e) => { void addDocuments(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <p className="text-xs text-[var(--text-muted)]">Videos: mp4, mov, mkv, avi, webm, mp3, wav, m4a (uploading does not use your daily videos; summarizing does). Documents: PDF, Word, PowerPoint, Excel, text, pictures.</p>
        </div>
        {docUploads.length > 0 && (
          <ul className="grid gap-2 sm:col-span-2" aria-label="Documents in progress">
            {docUploads.map((u) => (
              <li key={u.key} className="rounded-xl border border-[var(--card-border)] p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold">{u.name}</span>
                  {u.error ? <button onClick={() => setDocUploads((x) => x.filter((i) => i.key !== u.key))} aria-label={`Dismiss ${u.name}`}><X className="h-3.5 w-3.5" /></button> : <span>{Math.round(u.progress * 100)}%</span>}
                </div>
                {u.error ? <p className="mt-1 text-rose-600">{u.error}</p> : (
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-valuenow={Math.round(u.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span className="block h-full rounded-full bg-[var(--brand-lime)] transition-[width]" style={{ width: `${u.progress * 100}%` }} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {uploads.length > 0 && (
          <ul className="grid gap-2 sm:col-span-2" aria-label="Uploads in progress">
            {uploads.map((u) => (
              <li key={u.key} className="rounded-xl border border-[var(--card-border)] p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold">{u.name}</span>
                  {u.error ? <button onClick={() => setUploads((x) => x.filter((i) => i.key !== u.key))} aria-label={`Dismiss ${u.name}`}><X className="h-3.5 w-3.5" /></button> : <span>{Math.round(u.progress * 100)}%</span>}
                </div>
                {u.error ? <p className="mt-1 text-rose-600">{u.error}</p> : (
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-valuenow={Math.round(u.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span className="block h-full rounded-full bg-[var(--brand-lime)] transition-[width]" style={{ width: `${u.progress * 100}%` }} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div
        onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setListDrop(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setListDrop(false); }}
        onDrop={(e) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          setListDrop(false);
          void addDocuments(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-2xl ${listDrop ? "outline-2 outline-dashed outline-offset-4 outline-[var(--brand-lime)]" : ""}`}
      >
        {listDrop && <p className="mb-2 text-center text-xs font-bold text-[var(--text-muted)]">Drop to add the files to the list. Drop on a video to attach them to it instead.</p>}
        {playlist.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--card-border)] p-10 text-center text-sm text-[var(--text-muted)]">This playlist is empty. Add a video or a document above, or drop files here.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={playlist.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ul className="grid gap-2">
                {playlist.items.map((item) =>
                  item.kind === "document" ? (
                    <DocRow key={item.id} item={item} onRemove={() => remove(item)} onOpenFile={setViewing} onToast={onToast} />
                  ) : (
                    <Row key={item.id} item={item} summarizing={summarizing === item.id} onRemove={() => remove(item)} onSummarize={() => summarize(item)}
                      onOpenFile={setViewing} onChanged={load} onToast={onToast} />
                  ),
                )}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>
      {viewing && <DocumentViewer file={viewing} onClose={() => setViewing(null)} onToast={onToast} />}
    </div>
  );
}
