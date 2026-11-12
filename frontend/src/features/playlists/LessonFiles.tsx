"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Download, Paperclip, Plus, Trash2, UploadCloud, X } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton";
import { apiFetch, readError } from "../../lib/api";
import type { DocumentItem } from "../../lib/types";
import { downloadDocument, dragHasFiles, type UploadProgress } from "../documents/api";
import { FileBadge } from "../documents/FileBadge";
import { DOCUMENT_ACCEPT, formatBytes } from "../documents/files";

interface Props {
  title: string;
  files: DocumentItem[];
  pending: UploadProgress[];
  onUpload: (files: File[]) => Promise<void>;
  onDismiss: (key: string) => void;
  onOpen: (file: DocumentItem) => void;
  onChanged: () => Promise<void> | void;
  onToast: (message: string, type?: "success" | "info" | "error") => void;
}

/**
 * The paperclip on the right of a video row: how many files belong to it, and a small panel to
 * open, download, add and remove them. Files can also be dropped on the panel or on the whole row.
 */
export function LessonFiles({ title, files, pending, onUpload, onDismiss, onOpen, onChanged, onToast }: Props) {
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const remove = async (file: DocumentItem) => {
    if (!window.confirm(`Delete "${file.filename}"? This cannot be undone.`)) return;
    const res = await apiFetch(`/api/documents/${file.id}`, { method: "DELETE" });
    if (res.ok || res.status === 404) await onChanged();
    else onToast(await readError(res, "Could not delete this file."), "error");
  };

  const label = files.length === 0 ? `Add files to ${title}` : `${files.length} file${files.length === 1 ? "" : "s"} for ${title}`;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        title={files.length === 0 ? "Add files (PDF, Word, slides…)" : `${files.length} file${files.length === 1 ? "" : "s"}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold cursor-pointer transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] ${
          open || files.length > 0
            ? "border-[var(--brand-lime)] bg-[var(--brand-lime)]/25 text-[var(--text-main)]"
            : "border-[var(--card-border)] bg-[var(--btn-secondary-bg)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
        }`}
      >
        <Paperclip className="h-4 w-4" />
        {files.length > 0 ? <span className="tabular-nums">{files.length}</span> : <Plus className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Files for ${title}`}
          onDragOver={(e) => { if (dragHasFiles(e)) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            if (!dragHasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            void onUpload(Array.from(e.dataTransfer.files));
          }}
          className={`z-40 rounded-2xl border bg-[var(--card-bg)] p-3 shadow-xl max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-80 ${
            over ? "border-[var(--brand-lime)] ring-2 ring-[var(--brand-lime)]/40" : "border-[var(--card-border)]"
          }`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="min-w-0 truncate text-sm font-black">Files for this video</h4>
            <IconButton label="Close" size="sm" onClick={() => setOpen(false)}><X className="h-3.5 w-3.5" /></IconButton>
          </div>

          {files.length === 0 && pending.length === 0 && (
            <p className="mb-2 rounded-xl bg-[var(--btn-secondary-bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
              Add slides, assignments or notes for this video. PDF, Word, PowerPoint, Excel, text and pictures.
            </p>
          )}

          {files.length > 0 && (
            <ul className="mb-2 max-h-60 space-y-1 overflow-y-auto">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-[var(--btn-secondary-bg)]">
                  <FileBadge extension={file.extension} size={34} />
                  <button type="button" onClick={() => { setOpen(false); onOpen(file); }} className="min-w-0 flex-1 text-left cursor-pointer" aria-label={`Open ${file.filename}`}>
                    <span className="block truncate text-sm font-bold" title={file.filename}>{file.filename}</span>
                    <span className="block text-xs text-[var(--text-muted)]">{formatBytes(file.size_bytes)}</span>
                  </button>
                  <IconButton label={`Download ${file.filename}`} size="sm" onClick={() => void downloadDocument(file).catch(() => onToast("Could not start the download.", "error"))}>
                    <Download className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton label={`Delete ${file.filename}`} size="sm" tone="danger" onClick={() => void remove(file)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}

          {pending.length > 0 && (
            <ul className="mb-2 space-y-1.5" aria-label="Uploads in progress">
              {pending.map((p) => (
                <li key={p.key} className="rounded-xl border border-[var(--card-border)] p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-bold">{p.name}</span>
                    {p.error ? <button onClick={() => onDismiss(p.key)} aria-label={`Dismiss ${p.name}`}><X className="h-3.5 w-3.5" /></button> : <span>{Math.round(p.progress * 100)}%</span>}
                  </div>
                  {p.error ? <p className="mt-1 text-rose-600">{p.error}</p> : (
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <span className="block h-full rounded-full bg-[var(--brand-lime)] transition-[width]" style={{ width: `${p.progress * 100}%` }} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => input.current?.click()}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-xs font-bold cursor-pointer ${
              over ? "border-[var(--brand-lime)] bg-[var(--brand-lime)]/10" : "border-[var(--card-border)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            <UploadCloud className="h-4 w-4" /> Add files, or drop them here
          </button>
          <input ref={input} type="file" multiple accept={DOCUMENT_ACCEPT} className="sr-only" aria-label={`Choose files for ${title}`}
            onChange={(e) => { void onUpload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </div>
      )}
    </div>
  );
}
