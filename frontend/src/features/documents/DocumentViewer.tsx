"use client";

import React, { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton";
import { downloadDocument, getText, getViewInfo, type ViewInfo } from "./api";
import { FileBadge } from "./FileBadge";
import { canShowInline, documentKind, formatBytes } from "./files";

export interface ViewableFile {
  id: string;
  filename: string;
  extension: string;
  size_bytes: number;
}

type State =
  | { phase: "loading" }
  | { phase: "inline"; info: ViewInfo }
  | { phase: "text"; text: string }
  | { phase: "none" }
  | { phase: "error"; message: string };

const EXPLAIN: Record<string, string> = {
  word: "Word and similar documents cannot be shown here with their layout. This is the text found in the file.",
  slides: "Slides cannot be shown here with their layout. This is the text found on the slides.",
  sheet: "Spreadsheets cannot be shown here with their layout. This is the text found in the cells.",
  text: "",
  other: "This is the text found in the file.",
};

/**
 * Opens a file in the page. PDFs and pictures are shown as they are; everything else shows the
 * text read from it, with a download for the original. Escape or the close button leaves.
 */
export function DocumentViewer({ file, onClose, onToast }: {
  file: ViewableFile;
  onClose: () => void;
  onToast?: (message: string, type?: "success" | "info" | "error") => void;
}) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const closeButton = useRef<HTMLButtonElement>(null);
  const kind = documentKind(file.extension);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    (async () => {
      try {
        if (canShowInline(file.extension)) {
          const info = await getViewInfo(file.id);
          if (!cancelled && info) return setState({ phase: "inline", info });
        }
        const text = (await getText(file.id)).trim();
        if (!cancelled) setState(text ? { phase: "text", text } : { phase: "none" });
      } catch (err) {
        if (!cancelled) setState({ phase: "error", message: err instanceof Error ? err.message : "Could not open this file." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.id, file.extension]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  /** Some browsers (most phones) cannot show a PDF inside a page: offer the words in it instead. */
  const showText = async () => {
    try {
      const text = (await getText(file.id)).trim();
      setState(text ? { phase: "text", text } : { phase: "none" });
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "Could not read this file." });
    }
  };

  const download = () => void downloadDocument(file).catch((err) => onToast?.(err instanceof Error ? err.message : "Could not start the download.", "error"));

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/60 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Viewing ${file.filename}`}
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[var(--bg-app)] shadow-2xl sm:h-[90vh] sm:rounded-3xl sm:border sm:border-[var(--card-border)]">
        <header className="flex items-center gap-3 border-b border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2.5 sm:px-4">
          <FileBadge extension={file.extension} size={36} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-black" title={file.filename}>{file.filename}</h2>
            <p className="text-xs text-[var(--text-muted)]">{formatBytes(file.size_bytes)}</p>
          </div>
          {state.phase === "inline" && (
            <a href={state.info.url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab" title="Open in a new tab"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)]">
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
          <IconButton label="Download the original" onClick={download}><Download className="h-4 w-4" /></IconButton>
          <IconButton ref={closeButton} label="Close" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {state.phase === "loading" && (
            <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening…
            </div>
          )}
          {state.phase === "inline" && state.info.kind === "pdf" && (
            <div className="flex h-full flex-col">
              <iframe title={file.filename} src={state.info.url} className="min-h-0 flex-1 border-0 bg-white" />
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs text-[var(--text-muted)]">
                <span>Not showing?</span>
                <a href={state.info.url} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--text-main)] underline">Open the PDF in a new tab</a>
                <button type="button" onClick={() => void showText()} className="font-bold text-[var(--text-main)] underline cursor-pointer">Show its text</button>
              </p>
            </div>
          )}
          {state.phase === "inline" && state.info.kind === "image" && (
            <div className="flex h-full items-center justify-center bg-[var(--btn-secondary-bg)] p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={state.info.url} alt={file.filename} className="max-h-full max-w-full rounded-lg object-contain" />
            </div>
          )}
          {state.phase === "text" && (
            <div className="mx-auto max-w-3xl p-4 sm:p-6">
              {EXPLAIN[kind] && <p className="mb-3 rounded-xl bg-[var(--btn-secondary-bg)] px-3 py-2 text-xs text-[var(--text-muted)]">{EXPLAIN[kind]}</p>}
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[var(--text-main)]">{state.text}</pre>
            </div>
          )}
          {state.phase === "none" && (
            <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 p-6 text-center text-sm">
              <p className="font-bold">This file cannot be shown here.</p>
              <p className="text-[var(--text-muted)]">There is no text we can read in it, or it is a format browsers cannot open. You can still download it and open it with the right app.</p>
              <button onClick={download} className="inline-flex items-center gap-2 rounded-full bg-[var(--brand-lime)] px-5 py-2 font-black text-[#0E0F0C] cursor-pointer"><Download className="h-4 w-4" /> Download</button>
            </div>
          )}
          {state.phase === "error" && (
            <div role="alert" className="flex h-full items-center justify-center p-6 text-center text-sm">{state.message}</div>
          )}
        </div>
      </div>
    </div>
  );
}
