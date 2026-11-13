"use client";

import { track } from "../lib/analytics";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuth } from "../features/auth/AuthProvider";
import { Navbar } from "../components/Navbar";
import { HeroSection } from "../components/HeroSection";
import { ToolCard } from "../components/ToolCard";
import { GeneratingProgressCard } from "../components/GeneratingProgressCard";
import { ErrorCard } from "../components/ErrorCard";
import { FeaturesSection } from "../components/FeaturesSection";
import { FaqSection } from "../components/FaqSection";
import { Footer } from "../components/Footer";
import { JobState, JobResult } from "../lib/types";
import { apiFetch, readError } from "../lib/api";
import { watchJob } from "../lib/realtime";
import { SignInCard, SignInNudge } from "../features/guest/SignInCard";
import { YouTubePlayer } from "../features/player/YouTubePlayer";
import { extractYouTubeId } from "../features/player/youtube";
import {
  CheckCircle2,
  AlertCircle,
  Info,
  Loader2,
  WifiOff,
  ChevronUp,
  X,
  AlertTriangle,
} from "lucide-react";

/** Results open on their own page, so this view (with all its study tools, maths and Markdown code) is rarely needed here. */
const OutputWorkspace = dynamic(() => import("../components/OutputWorkspace").then((m) => m.OutputWorkspace), { ssr: false });

export default function Home() {
  const { signedIn, configured: authConfigured, ensureSession } = useAuth();
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [job, setJob] = useState<JobState | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [resultVideoId, setResultVideoId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "error" | "warning" } | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [showBackToTop, setShowBackToTop] = useState(false);

  /** Why the sign-in card is open (an account-only action was tried), or null. */
  const [gate, setGate] = useState<{ title: string; message: string } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const handleUrlChange = React.useCallback((value: string) => setPreviewId(extractYouTubeId(value)), []);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const stopWatchingRef = useRef<(() => void) | null>(null);
  const lastInputRef = useRef<{ type: "url" | "upload"; value: string } | null>(null);
  const lastSubmittedFileRef = useRef<File | null>(null);

  // Load theme from localStorage
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as "dark" | "light") || "light";
    setTheme(saved);
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(saved);
  }, []);

  // Offline / Online Detection
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      showToast("Internet connection restored.", "success");
    };

    const handleOffline = () => {
      setIsOnline(false);
      showToast("Internet connection lost. You are currently offline.", "error");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Back to top scroll listener
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 420);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(next);
      return next;
    });
  };

  const showToast = (message: string, type: "success" | "info" | "error" | "warning" = "info") => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3800);
  };

  const stopTracking = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    stopWatchingRef.current?.();
    stopWatchingRef.current = null;
  };

  // Progress arrives instantly through Supabase Realtime. Polling every few
  // seconds is the safety net in case the live connection is unavailable.
  const startPolling = (jobId: string) => {
    stopTracking();

    const refresh = async () => {
      try {
        const res = await apiFetch(`/api/job/${jobId}`);
        if (!res.ok) {
          if (res.status === 404) {
            stopTracking();
            showToast("Job session expired or not found.", "error");
          }
          return;
        }
        const data: JobState = await res.json();
        setJob(data);

        if (data.status === "completed") {
          stopTracking();
          track("summary_ready");
          if (data.video_id) {
            // The result gets its own page, so this page stays just as it was.
            router.push(`/summary/${data.video_id}`);
          } else if (data.result) {
            setResult(data.result);
            showToast("Video summarized successfully!", "success");
          }
        } else if (data.status === "failed") {
          stopTracking();
          showToast(data.error || "Summarization failed", "error");
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    stopWatchingRef.current = watchJob(jobId, refresh);
    pollingRef.current = setInterval(refresh, 3000);
    void refresh();
  };

  useEffect(() => stopTracking, []);

  /** Uploads (large files, heavy processing) need an account. Pasting a link is free without one. */
  const requireAccountForUpload = (): boolean => {
    if (signedIn || !authConfigured) return false;
    setGate({ title: "Sign in to upload files", message: "Uploading your own video or audio needs a free account. Pasting a YouTube link works without one." });
    return true;
  };

  const handleUrlSubmit = async (url: string, force: boolean = false) => {
    const trimmed = url.trim();
    if (!trimmed) return;

    if (!navigator.onLine) {
      showToast("Cannot process video while offline. Please reconnect.", "error");
      return;
    }
    // Visitors try it without an account: a guest session is opened quietly, right now, and only now.
    if (authConfigured && !(await ensureSession())) {
      setGate({ title: "Sign in to continue", message: "We could not start the free try-out. Sign in to summarize this video." });
      return;
    }

    if (!force && result && lastInputRef.current?.type === "url" && lastInputRef.current?.value === trimmed) {
      showToast("Summary already generated for this video.", "info");
      const workspaceEl = document.getElementById("workspace-container");
      if (workspaceEl) {
        workspaceEl.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }

    lastInputRef.current = { type: "url", value: trimmed };
    if (!force) {
      setResult(null);
      setResultVideoId(null);
    }

    setJob({
      id: "init",
      type: "url",
      status: "queued",
      step: 1,
      step_name: "Connecting",
      progress: 5,
      message: force ? "Regenerating summary..." : "Initiating video pipeline...",
    });

    try {
      const res = await apiFetch("/api/summarize/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to start summarization"));
      }
      const data = await res.json();
      track("summary_submitted", { source: "youtube" });

      showToast(force ? "Regenerating summary..." : "Pipeline initiated!", "info");
      startPolling(data.job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error submitting URL";
      setJob({
        id: "err",
        type: "url",
        status: "failed",
        step: 1,
        step_name: "Error",
        progress: 0,
        message: msg,
        error: msg,
      });
      showToast(msg, "error");
    }
  };

  const handleUploadSubmit = async (file: File, force: boolean = false) => {
    if (requireAccountForUpload()) return;
    const fileId = `${file.name}_${file.size}_${file.lastModified}`;

    if (!force && result && lastInputRef.current?.type === "upload" && lastInputRef.current?.value === fileId) {
      showToast("Summary already generated for this file.", "info");
      const workspaceEl = document.getElementById("workspace-container");
      if (workspaceEl) {
        workspaceEl.scrollIntoView({ behavior: "smooth" });
      }
      return;
    }

    lastInputRef.current = { type: "upload", value: fileId };
    lastSubmittedFileRef.current = file;
    if (!force) {
      setResult(null);
      setResultVideoId(null);
    }

    setJob({
      id: "init",
      type: "upload",
      status: "queued",
      step: 1,
      step_name: "Uploading",
      progress: 10,
      message: force ? "Regenerating summary..." : "Uploading media...",
    });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await apiFetch("/api/summarize/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        throw new Error(await readError(res, "Failed to upload file"));
      }
      const data = await res.json();

      showToast(force ? "Regenerating summary..." : "File uploaded! Processing audio...", "info");
      startPolling(data.job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error uploading file";
      setJob({
        id: "err",
        type: "upload",
        status: "failed",
        step: 1,
        step_name: "Error",
        progress: 0,
        message: msg,
        error: msg,
      });
      showToast(msg, "error");
    }
  };

  const handleRegenerateSummary = () => {
    if (!lastInputRef.current) return;
    if (lastInputRef.current.type === "url") {
      handleUrlSubmit(lastInputRef.current.value, true);
    } else if (lastSubmittedFileRef.current) {
      handleUploadSubmit(lastSubmittedFileRef.current, true);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-main)] transition-colors" suppressHydrationWarning>
      {/* Offline Status Top Banner */}
      {!isOnline && (
        <div
          role="alert"
          className="sticky top-0 z-[60] w-full bg-amber-500 text-[#0E0F0C] font-bold text-xs py-2 px-4 flex items-center justify-center gap-2 shadow-sm animate-in fade-in"
        >
          <WifiOff className="w-4 h-4" />
          <span>You are currently offline. Video downloads and processing require an active network connection.</span>
        </div>
      )}

      <Navbar theme={theme} onToggleTheme={toggleTheme} />

      {/* ============================================================
           HERO & TOOL SECTION — CLEAN & CENTERED
           ============================================================ */}
      <section className="w-full px-4 sm:px-6 pt-10 sm:pt-14 md:pt-18 pb-12 sm:pb-16 no-print">
        <div className="w-full max-w-5xl mx-auto">
          <ToolCard
            isProcessing={job?.status === "processing" || job?.status === "queued"}
            onSubmitUrl={handleUrlSubmit}
            onSubmitUpload={handleUploadSubmit}
            onError={(msg) => showToast(msg, "error")}
            onUrlChange={handleUrlChange}
          />
          {previewId && (
            <div className="mx-auto mt-6 max-w-2xl" aria-label="Video preview">
              <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Preview</p>
              <YouTubePlayer videoId={previewId} />
            </div>
          )}
        </div>
      </section>

      {/* ============================================================
           MAIN WORKSPACE & CONTENT CONTAINER
           ============================================================ */}
      <main className="flex-1 max-w-[1180px] w-full mx-auto px-3 sm:px-6 pb-12 sm:pb-16">
        {/* Intelligent Audio Waveform & Progress Card */}
        {job && (job.status === "processing" || job.status === "queued") && (
          <GeneratingProgressCard job={job} />
        )}

        {/* Redesigned Error State Card with Retry & Diagnostics */}
        {job && job.status === "failed" && (
          <ErrorCard
            error={job.error}
            onRetry={handleRegenerateSummary}
            onDismiss={() => setJob(null)}
          />
        )}

        {/* Output Workspace (When Summary is Ready) */}
        {result && resultVideoId && (
          <div className="mb-3 text-right">
            <Link href={`/video/${resultVideoId}`} className="text-sm font-bold underline underline-offset-4">
              Open full workspace with video player →
            </Link>
          </div>
        )}
        {result && (
          <OutputWorkspace
            videoId={resultVideoId}
            result={result}
            onToast={showToast}
          />
        )}

        {/* Core Capabilities & Workflow */}
        <FeaturesSection />

        {/* Frequently Asked Questions with Accordion Animations */}
        <FaqSection />
      </main>

      {/* Modern Footer */}
      <Footer />

      {/* Floating Back to Top Button */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          aria-label="Back to top"
          className="fixed bottom-22 right-6 z-40 w-11 h-11 rounded-full bg-[var(--card-bg)] hover:bg-[var(--brand-lime)] hover:text-[#0E0F0C] text-[var(--text-main)] border border-[var(--card-border)] shadow-lg flex items-center justify-center transition-all cursor-pointer active:scale-95 animate-in fade-in zoom-in-90 duration-200"
          title="Back to top"
        >
          <ChevronUp className="w-5 h-5 stroke-[2.5]" />
        </button>
      )}

      {/* After a few seconds on the site, anyone without an account is invited to sign in (once; dismissals are remembered). */}
      {!gate && <SignInNudge />}
      {gate && <SignInCard title={gate.title} message={gate.message} next="/" onClose={() => setGate(null)} />}

      {/* Floating Toast Notification System */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] shadow-2xl text-xs font-bold animate-in fade-in slide-in-from-bottom-3 duration-200 text-[var(--text-main)] max-w-sm"
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] shrink-0" />
          ) : toast.type === "error" ? (
            <AlertCircle className="w-4 h-4 text-[var(--color-danger)] shrink-0" />
          ) : toast.type === "warning" ? (
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)] shrink-0" />
          )}
          <span className="flex-1 leading-snug">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
