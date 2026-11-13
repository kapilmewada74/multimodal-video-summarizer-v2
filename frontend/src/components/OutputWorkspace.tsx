"use client";

import React, { useState, useMemo, useEffect } from "react";
import { renderMarkdownWithMath } from "../lib/mathUtils";
import { escapeHtml, sanitizeHtml } from "../lib/sanitize";
import { MindMapView } from "../features/workspace/MindMapView";
import { ShareExportBar } from "../features/workspace/ShareExportBar";
import { NotesPane } from "../features/notes/NotesPane";
import { DocumentsManager } from "../features/documents/DocumentsManager";
import { ActionMenu } from "./ui/ActionMenu";
import { IconButton } from "./ui/IconButton";
import { DocumentContextToggle, useUsableDocumentCount } from "../features/documents/DocumentContextToggle";
import { useEdit } from "../features/edits/useEdit";
import { SummaryEditor } from "../features/edits/SummaryEditor";
import { SlidesEditor } from "../features/edits/SlidesEditor";
import type { MindMapData, OutputKind } from "../lib/types";
import {
  Copy,
  Download,
  Printer,
  FileText,
  Check,
  Layers,
  Network,
  Paperclip,
  StickyNote,
  Presentation as PresentationIcon,
  ArrowRight,
  AlignLeft,
  Bookmark,
  Heart,
  Pencil
} from "lucide-react";
import { JobResult } from "../lib/types";
import dynamic from "next/dynamic";
import type { Flashcard } from "./FlashcardsView";
import type { PresentationData } from "./PresentationView";
import type { QuizQuestion } from "./QuizView";

/** A tab's code is downloaded the first time that tab is opened, not with the page (the animation library alone is ~50 KB). */
const tabLoading = () => (
  <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Loading…
  </div>
);
const FlashcardsView = dynamic(() => import("./FlashcardsView").then((m) => m.FlashcardsView), { ssr: false, loading: tabLoading });
const PresentationView = dynamic(() => import("./PresentationView").then((m) => m.PresentationView), { ssr: false, loading: tabLoading });
const QuizView = dynamic(() => import("./QuizView").then((m) => m.QuizView), { ssr: false, loading: tabLoading });
import { apiFetch, readError } from "../lib/api";

function cleanAndDeduplicateSummary(rawText: string): string {
  if (!rawText) return "";

  // 1. Remove hallucinated CJK characters and punctuation
  let cleaned = rawText.replace(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]+/g, "");
  cleaned = cleaned.replace(/\(\s*\)/g, "");
  cleaned = cleaned.replace(/\(\s*Section\s*\d*\s*\)/gi, "");
  cleaned = cleaned.replace(/\*\*\s*\*\*/g, "");
  cleaned = cleaned.replace(/^\s*[-*]\s*[-*:\s]*$/gm, "");

  // 2. Check for duplicate blocks separated by --- or repeated # Video Summary / ## Main Topic
  let parts = cleaned.split(/\n\s*---\s*\n/);
  if (parts.length <= 1) {
    const summaryHeaderMatches = [...cleaned.matchAll(/(?:^|\n)#+\s*Video Summary/gi)];
    if (summaryHeaderMatches.length > 1) {
      parts = [cleaned.slice(0, summaryHeaderMatches[1].index), cleaned.slice(summaryHeaderMatches[1].index)];
    }
  }

  if (parts.length <= 1) {
    const mainTopicMatches = [...cleaned.matchAll(/(?:^|\n)##\s*Main Topic/gi)];
    if (mainTopicMatches.length > 1) {
      parts = [cleaned.slice(0, mainTopicMatches[1].index), cleaned.slice(mainTopicMatches[1].index)];
    }
  }

  if (parts.length <= 1) {
    // Strip leading # Video Summary or # Summary heading since we have a dedicated UI header row
    return cleaned.replace(/^\s*#+\s*(?:Video\s+)?Summary\s*\n+/i, "").trim();
  }

  // Multiple blocks detected - merge them
  const mainTopics: string[] = [];
  const keyConcepts: string[] = [];
  const detailedBreakdowns: string[] = [];
  const keyTakeaways: string[] = [];

  for (const part of parts) {
    const mtMatch = part.match(/##\s*Main Topic\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (mtMatch) {
      const mt = mtMatch[1].trim();
      if (mt && !mainTopics.includes(mt)) mainTopics.push(mt);
    }

    const kcMatch = part.match(/##\s*Key Concepts\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (kcMatch) {
      const lines = kcMatch[1].trim().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
          const item = trimmed.replace(/^[-*]\s*/, "").replace(/^[-:\s]+/, "").trim();
          if (item && !keyConcepts.some((e) => e.toLowerCase() === item.toLowerCase())) {
            keyConcepts.push(item);
          }
        }
      }
    }

    const dbMatch = part.match(/##\s*Detailed Breakdown\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (dbMatch) {
      const lines = dbMatch[1].trim().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
          const item = trimmed.replace(/^[-*]\s*/, "").replace(/^[-:\s]+/, "").trim();
          if (item && !detailedBreakdowns.some((e) => e.toLowerCase() === item.toLowerCase())) {
            detailedBreakdowns.push(item);
          }
        }
      }
    }

    const ktMatch = part.match(/##\s*Key Takeaways\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (ktMatch) {
      const lines = ktMatch[1].trim().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
          const item = trimmed.replace(/^[-*]\s*/, "").replace(/^[-:\s]+/, "").trim();
          if (item && !keyTakeaways.some((e) => e.toLowerCase() === item.toLowerCase())) {
            keyTakeaways.push(item);
          }
        } else if (trimmed && !trimmed.startsWith("#") && trimmed.length > 3) {
          if (!keyTakeaways.includes(trimmed)) keyTakeaways.push(trimmed);
        }
      }
    }
  }

  const out: string[] = [];
  if (mainTopics.length) {
    out.push("## Main Topic\n" + mainTopics.join(" ") + "\n");
  }
  if (keyConcepts.length) {
    out.push("## Key Concepts\n" + keyConcepts.map((c) => `- ${c}`).join("\n") + "\n");
  }
  if (detailedBreakdowns.length) {
    out.push("## Detailed Breakdown\n" + detailedBreakdowns.map((b) => `- ${b}`).join("\n") + "\n");
  }
  if (keyTakeaways.length) {
    out.push("## Key Takeaways\n" + keyTakeaways.map((t) => (t.startsWith("-") ? t : `- ${t}`)).join("\n") + "\n");
  }

  return out.join("\n").trim();
}

interface OutputWorkspaceProps {
  result: JobResult;
  /** The saved video. Flashcards, slides, quiz and mind map are stored per video. */
  videoId?: string | null;
  onToast: (msg: string, type?: "success" | "info" | "error") => void;
  onRegenerateSummary?: () => void;
  isRegeneratingSummary?: boolean;
}

export function OutputWorkspace({
  result,
  videoId,
  onToast,
}: OutputWorkspaceProps) {
  const tabStrip = React.useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "transcript" | "flashcards" | "mindmap" | "presentation" | "quiz" | "notes" | "documents">("summary");
  // On a phone the tabs scroll sideways: keep the chosen one in view.
  useEffect(() => {
    const strip = tabStrip.current;
    const active = strip?.querySelector<HTMLElement>(".font-black");
    if (strip && active && strip.scrollWidth > strip.clientWidth) {
      strip.scrollTo({ left: active.offsetLeft - 12, behavior: "smooth" });
    }
  }, [activeTab]);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("bookmarked_summaries") || "[]");
      setIsBookmarked(saved.includes(result.title));
    } catch {
      setIsBookmarked(false);
    }
  }, [result.title]);

  const toggleBookmark = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("bookmarked_summaries") || "[]");
      let next: string[];
      if (saved.includes(result.title)) {
        next = saved.filter((t: string) => t !== result.title);
        setIsBookmarked(false);
        onToast("Removed from saved bookmarks.", "info");
      } else {
        next = [...saved, result.title];
        setIsBookmarked(true);
        onToast("Saved to your local bookmarks!", "success");
      }
      localStorage.setItem("bookmarked_summaries", JSON.stringify(next));
    } catch {
      onToast("Unable to access local storage.", "error");
    }
  };

  // Advanced features state
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [flashcardsProvider, setFlashcardsProvider] = useState<string>("");
  const [isLoadingFlashcards, setIsLoadingFlashcards] = useState(false);

  // Optionally let the AI also read the user's own documents (the result is then private to them).
  const [useDocs, setUseDocs] = useState(false);
  const [usedDocs, setUsedDocs] = useState<string[]>([]);
  const usableDocs = useUsableDocumentCount(videoId, activeTab === "documents");

  const [presentation, setPresentation] = useState<PresentationData | null>(null);
  const slidesEdit = useEdit<PresentationData>(videoId, "slides", presentation ?? { title: "", slides: [] });
  const [editingSlides, setEditingSlides] = useState(false);
  const shownPresentation = slidesEdit.edit ?? presentation;
  const [isLoadingPresentation, setIsLoadingPresentation] = useState(false);

  const [mindmap, setMindmap] = useState<MindMapData | null>(null);
  const [isLoadingMindmap, setIsLoadingMindmap] = useState(false);

  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [quizProvider, setQuizProvider] = useState<string>("");
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);

  const cleanedSummary = useMemo(() => {
    return cleanAndDeduplicateSummary(result.summary || "");
  }, [result.summary]);

  // Your own edited copy wins over the AI summary; the AI version is never changed.
  const summaryEdit = useEdit<{ markdown: string }>(videoId, "summary", { markdown: cleanedSummary });
  const [editingSummary, setEditingSummary] = useState(false);
  const shownSummary = summaryEdit.edit?.markdown ?? cleanedSummary;

  const fullSummaryForExport = useMemo(() => {
    return `# Video Summary\n\n${shownSummary}`;
  }, [shownSummary]);

  // Render markdown with KaTeX math formula rendering
  const renderedSummaryHtml = useMemo(() => {
    if (!shownSummary) return "";
    return renderMarkdownWithMath(shownSummary);
  }, [shownSummary]);

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(fullSummaryForExport);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2000);
      onToast("Summary copied to clipboard!", "success");
    } catch {
      onToast("Failed to copy summary", "error");
    }
  };

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(result.transcript);
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 2000);
      onToast("Transcript copied to clipboard!", "success");
    } catch {
      onToast("Failed to copy transcript", "error");
    }
  };

  const handleDownloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onToast(`Downloaded ${filename}`, "success");
  };

  const printCleanPdf = (title: string, contentHtml: string) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>
    @page {
      margin: 16mm;
      size: auto;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #111111;
      background: #ffffff;
      line-height: 1.6;
      padding: 0;
      margin: 0;
    }
    .pdf-header {
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid #eaeaea;
    }
    .pdf-title {
      font-size: 22px;
      font-weight: 800;
      color: #0E0F0C;
      margin: 0;
    }
    .pdf-body {
      font-size: 13.5px;
      color: #222222;
      line-height: 1.7;
    }
    h1, h2, h3, h4 { color: #0E0F0C; font-weight: 700; margin-top: 18px; margin-bottom: 8px; }
    h1 { font-size: 18px; }
    h2 { font-size: 15px; }
    h3 { font-size: 13.5px; }
    p { margin: 8px 0; }
    ul, ol { padding-left: 20px; margin: 8px 0; }
    li { margin: 4px 0; }
    code { font-family: monospace; background: #f4f4f4; padding: 2px 4px; border-radius: 4px; font-size: 12px; }
    pre { background: #f4f4f4; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
    .transcript-line { margin-bottom: 10px; font-size: 13.5px; color: #222; }
  </style>
</head>
<body>
  <div class="pdf-header">
    <h1 class="pdf-title">${escapeHtml(title)}</h1>
  </div>
  <div class="pdf-body">
    ${sanitizeHtml(contentHtml)}
  </div>
</body>
</html>`);
    doc.close();

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1000);
    }, 250);
  };

  // --- Generation Handlers ---
  // The first request generates an output; after that the saved copy opens
  // instantly (and is shared with everyone who has this video).
  const openOutput = async (kind: OutputKind, body: Record<string, unknown> = {}) => {
    if (!videoId) throw new Error("This video is not saved yet. Open it from your library.");
    const res = await apiFetch(`/api/videos/${videoId}/outputs/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, use_documents: useDocs }),
    });
    if (!res.ok) throw new Error(await readError(res, "Could not generate this. Please try again."));
    const data = await res.json();
    setUsedDocs(Array.isArray(data.used_documents) ? data.used_documents : []);
    return data;
  };

  const handleGenerateFlashcards = async (forceRefresh: boolean = false) => {
    setIsLoadingFlashcards(true);
    try {
      const data = await openOutput("flashcards", { force: forceRefresh });
      setFlashcards(data.flashcards || []);
      setFlashcardsProvider(data.provider || "");
      if (forceRefresh) onToast("Flashcards regenerated!", "success");
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error generating flashcards", "error");
    } finally {
      setIsLoadingFlashcards(false);
    }
  };

  const handleGeneratePresentation = async (forceRefresh: boolean = false) => {
    if (forceRefresh && slidesEdit.edit) {
      // Making new AI slides would hide the edited ones, so say so first. The edit stays in the history.
      if (!window.confirm("Make new slides? Your edited slides are kept in History.")) return;
      try {
        await slidesEdit.reset();
        setEditingSlides(false);
      } catch (err: unknown) {
        onToast(err instanceof Error ? err.message : "Could not reset your slides", "error");
        return;
      }
    }
    setIsLoadingPresentation(true);
    try {
      const data = await openOutput("slides", { force: forceRefresh });
      setPresentation(data);
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error generating slides", "error");
    } finally {
      setIsLoadingPresentation(false);
    }
  };

  const handleGenerateMindmap = async (forceRefresh: boolean = false) => {
    setIsLoadingMindmap(true);
    try {
      setMindmap(await openOutput("mindmap", { force: forceRefresh }));
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error generating the mind map", "error");
    } finally {
      setIsLoadingMindmap(false);
    }
  };

  // After the "use my documents" switch changes, load the tab in view again with the new setting.
  const [reloadTab, setReloadTab] = useState<string | null>(null);
  useEffect(() => {
    if (!reloadTab) return;
    setReloadTab(null);
    if (reloadTab === "flashcards") void handleGenerateFlashcards();
    else if (reloadTab === "mindmap") void handleGenerateMindmap();
    else if (reloadTab === "presentation") void handleGeneratePresentation();
    // quiz waits for the user to press its own generate button
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTab]);

  const handleGenerateQuiz = async (difficulty: string = "medium", numQuestions: number = 5, forceRefresh: boolean = false) => {
    setIsLoadingQuiz(true);
    try {
      const data = await openOutput("quiz", { difficulty, num_questions: numQuestions, force: forceRefresh });
      setQuiz(data.quiz || []);
      setQuizProvider(data.provider || "");
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : "Error generating quiz", "error");
    } finally {
      setIsLoadingQuiz(false);
    }
  };

  const handleQuizComplete = (score: number, total: number, difficulty: string) => {
    if (!videoId) return;
    apiFetch(`/api/videos/${videoId}/quiz-attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, total, difficulty }),
    })
      .then((res) => {
        if (res.ok) onToast(`Quiz saved: ${score} of ${total}.`, "success");
      })
      .catch(() => undefined);
  };

  const transcriptLines = useMemo(() => {
    if (!result.transcript) return [];
    return result.transcript.split("\n").filter((l) => l.trim().length > 0);
  }, [result.transcript]);

  const safeFilename = (result.title || "video").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);

  return (
    <div id="workspace-container" className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-[18px] p-6 sm:p-8 shadow-xl mt-2 sm:mt-4 mb-20 sm:mb-28 lg:mb-32 print-content transition-colors">
      {/* Video Title Header */}
      <div className="border-b border-[var(--card-border)] pb-5 mb-6 no-print">
        <h2 className="text-xl sm:text-2xl font-black text-[var(--text-main)] break-words">
          {result.title || "Video"}
        </h2>
        {videoId && (
          <div className="mt-4">
            <ShareExportBar videoId={videoId} title={result.title || null} onToast={onToast} />
          </div>
        )}
      </div>

      {/* 5 High Contrast Navigation Tabs */}
      <div ref={tabStrip} role="group" aria-label="Study tools" className="flex gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible border-b border-[var(--card-border)] pb-3 mb-6 no-print [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          onClick={() => setActiveTab("summary")}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
            activeTab === "summary"
              ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
              : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Summary</span>
        </button>

        <button
          onClick={() => setActiveTab("transcript")}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
            activeTab === "transcript"
              ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
              : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
          }`}
        >
          <AlignLeft className="w-4 h-4" />
          <span>Transcript</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("flashcards");
            if (flashcards.length === 0) handleGenerateFlashcards();
          }}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
            activeTab === "flashcards"
              ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
              : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Flashcards</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("mindmap");
            if (!mindmap) handleGenerateMindmap();
          }}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
            activeTab === "mindmap"
              ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
              : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
          }`}
        >
          <Network className="w-4 h-4" />
          <span>Mind map</span>
        </button>

        <button
          onClick={() => {
            setActiveTab("presentation");
            if (!presentation) handleGeneratePresentation();
          }}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
            activeTab === "presentation"
              ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
              : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
          }`}
        >
          <PresentationIcon className="w-4 h-4" />
          <span>Presentation (PPT)</span>
        </button>

        {videoId && (
          <button
            onClick={() => setActiveTab("notes")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
              activeTab === "notes"
                ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
                : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
            }`}
          >
            <StickyNote className="w-4 h-4" />
            <span>My notes</span>
          </button>
        )}

        {videoId && (
          <button
            onClick={() => setActiveTab("documents")}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
              activeTab === "documents"
                ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
                : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
            }`}
          >
            <Paperclip className="w-4 h-4" />
            <span>Documents</span>
          </button>
        )}

        <button
          onClick={() => setActiveTab("quiz")}
          className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 ${
            activeTab === "quiz"
              ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-xs font-black"
              : "text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--btn-secondary-bg)]"
          }`}
        >
          <span>Quiz</span>
        </button>
      </div>

      {videoId && ["flashcards", "mindmap", "presentation", "quiz"].includes(activeTab) && (
        <DocumentContextToggle
          count={usableDocs}
          checked={useDocs}
          used={usedDocs}
          onChange={(next) => {
            setUseDocs(next);
            setUsedDocs([]);
            // The other version is a different set of results: clear them and load the one in view.
            setFlashcards([]);
            setQuiz([]);
            setMindmap(null);
            setPresentation(null);
            setReloadTab(activeTab);
          }}
        />
      )}

      {/* Tab 1: AI Summary Content Pane */}
      {activeTab === "summary" && (
        <div>
          {/* Summary Header: "Video Summary" on left, [Copy Summary] [PDF] [.TXT] on right-most side */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-6 pb-4 border-b border-[var(--card-border)] no-print">
            <h3 className="text-xl sm:text-2xl font-black text-[var(--text-main)] tracking-tight">
              Video Summary
            </h3>
            <div className="flex items-center gap-2 sm:shrink-0">
              <IconButton
                label={isBookmarked ? "Remove from favorites" : "Save to favorites"}
                onClick={toggleBookmark}
                aria-pressed={isBookmarked}
                className={isBookmarked ? "!border-rose-500/30 !bg-rose-500/15 !text-rose-600 dark:!text-rose-400" : ""}
              >
                <Heart className={`h-4 w-4 ${isBookmarked ? "fill-current" : ""}`} />
              </IconButton>

              {videoId && !editingSummary && cleanedSummary && (
                <IconButton
                  label={summaryEdit.edit ? "Edit your version of the summary" : "Edit the summary (the AI version is kept)"}
                  onClick={() => setEditingSummary(true)}
                  disabled={!summaryEdit.loaded}
                  active={summaryEdit.edit !== null}
                >
                  <Pencil className="h-4 w-4" />
                </IconButton>
              )}

              <IconButton label={copiedSummary ? "Copied" : "Copy the summary"} onClick={handleCopySummary}>
                {copiedSummary ? <Check className="h-4 w-4 text-[var(--color-success)]" /> : <Copy className="h-4 w-4" />}
              </IconButton>

              <ActionMenu
                label="Download the summary"
                icon={<Download className="h-4 w-4" />}
                heading="Download as"
                width="w-52"
                items={[
                  { key: "pdf", label: "PDF", hint: "Opens the print dialog", icon: <Printer className="h-4 w-4" />, onSelect: () => printCleanPdf(result.title || "Video Summary", renderedSummaryHtml) },
                  { key: "txt", label: "Text (.txt)", hint: "Plain text", icon: <FileText className="h-4 w-4" />, onSelect: () => handleDownloadFile(fullSummaryForExport, `${safeFilename}_summary.txt`, "text/plain") },
                  { key: "md", label: "Markdown (.md)", hint: "Keeps the formatting", icon: <FileText className="h-4 w-4" />, onSelect: () => handleDownloadFile(fullSummaryForExport, `${safeFilename}_summary.md`, "text/markdown") },
                ]}
              />
            </div>
          </div>

          {editingSummary && videoId ? (
            <SummaryEditor aiText={cleanedSummary} state={summaryEdit} onDone={() => setEditingSummary(false)} onToast={onToast} />
          ) : (
            <div
              className="markdown-content text-sm sm:text-base leading-relaxed text-[var(--text-main)]"
              dangerouslySetInnerHTML={{ __html: renderedSummaryHtml }}
            />
          )}
        </div>
      )}

      {/* Tab 2: Full Transcript Content Pane */}
      {activeTab === "transcript" && (
        <div>
          {/* Transcript Export Toolbar */}
          <div className="flex flex-wrap items-center justify-end gap-2 mb-4 no-print">
            <IconButton label={copiedTranscript ? "Copied" : "Copy the transcript"} onClick={handleCopyTranscript}>
              {copiedTranscript ? <Check className="h-4 w-4 text-[var(--color-success)]" /> : <Copy className="h-4 w-4" />}
            </IconButton>
            <ActionMenu
              label="Download the transcript"
              icon={<Download className="h-4 w-4" />}
              heading="Download as"
              width="w-52"
              items={[
                {
                  key: "pdf", label: "PDF", hint: "Opens the print dialog", icon: <Printer className="h-4 w-4" />,
                  onSelect: () => {
                    const transcriptHtml = result.transcript
                      .split("\n")
                      .filter((l) => l.trim().length > 0)
                      .map((l) => `<p class="transcript-line">${escapeHtml(l)}</p>`)
                      .join("");
                    printCleanPdf(`${result.title || "Video"} — Transcript`, transcriptHtml);
                  },
                },
                { key: "txt", label: "Text (.txt)", hint: "Plain text", icon: <FileText className="h-4 w-4" />, onSelect: () => handleDownloadFile(result.transcript, `${safeFilename}_transcript.txt`, "text/plain") },
              ]}
            />
          </div>

          <div className="max-h-[480px] overflow-y-auto space-y-2.5 pr-2">
            {transcriptLines.length > 0 ? (
              transcriptLines.map((line, idx) => (
                <p key={idx} className="text-sm leading-relaxed text-[var(--text-main)]">
                  {line}
                </p>
              ))
            ) : (
              <p className="text-xs text-[var(--text-muted)] py-4">No transcript available.</p>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Flashcards Pane */}
      {activeTab === "flashcards" && (
        <FlashcardsView
          cards={flashcards}
          provider={flashcardsProvider}
          isLoading={isLoadingFlashcards}
          onGenerate={handleGenerateFlashcards}
        />
      )}

      {/* Mind map pane */}
      {activeTab === "mindmap" && (
        <MindMapView data={mindmap} isLoading={isLoadingMindmap} onGenerate={handleGenerateMindmap} onToast={onToast} />
      )}

      {/* Tab 4: Presentation (PPT) Pane */}
      {activeTab === "presentation" && (
        <>
        {videoId && presentation && (
          editingSlides ? (
            <SlidesEditor ai={presentation} state={slidesEdit} onDone={() => setEditingSlides(false)} onToast={onToast} />
          ) : (
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => setEditingSlides(true)}
                disabled={!slidesEdit.loaded}
                className="px-4 py-1.5 rounded-full bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)] text-[var(--btn-secondary-text)] border border-[var(--card-border)] text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Edit these slides. The AI version is kept."
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{slidesEdit.edit ? "Edit slides (yours)" : "Edit slides"}</span>
              </button>
            </div>
          )
        )}
        <PresentationView
          data={shownPresentation}
          isLoading={isLoadingPresentation}
          onGenerate={() => handleGeneratePresentation(true)}
          onToast={onToast}
        />
        </>
      )}

      {/* Tab 5: Quiz Pane */}
      {activeTab === "quiz" && (
        <QuizView
          quiz={quiz}
          provider={quizProvider}
          isLoading={isLoadingQuiz}
          onGenerate={handleGenerateQuiz}
          onComplete={handleQuizComplete}
        />
      )}

      {/* Documents pane */}
      {activeTab === "documents" && videoId && <DocumentsManager videoId={videoId} onToast={onToast} />}

      {/* My notes pane */}
      {activeTab === "notes" && videoId && (
        <NotesPane videoId={videoId} />
      )}
    </div>
  );
}
