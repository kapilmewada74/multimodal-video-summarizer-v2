"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../features/auth/AuthProvider";
import { Navbar } from "../components/Navbar";
import { HeroSection } from "../components/HeroSection";
import { ToolCard } from "../components/ToolCard";
import { OutputWorkspace } from "../components/OutputWorkspace";
import { GeneratingProgressCard } from "../components/GeneratingProgressCard";
import { ErrorCard } from "../components/ErrorCard";
import { FeaturesSection } from "../components/FeaturesSection";
import { FaqSection } from "../components/FaqSection";
import { Footer } from "../components/Footer";
import { JobState, JobResult } from "../lib/types";
import { apiFetch, readError } from "../lib/api";
import { watchJob } from "../lib/realtime";
import { UsageBadge } from "../features/limits/UsageBadge";
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

const PENDING_URL_KEY = "pending-summarize-url";

export default function Home() {
  const { ready: authReady, signedIn, configured: authConfigured } = useAuth();
  const router = useRouter();
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [job, setJob] = useState<JobState | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const [resultVideoId, setResultVideoId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "error" | "warning" } | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const [usageRefresh, setUsageRefresh] = useState(0);
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
          setUsageRefresh((n) => n + 1);
          if (data.result) {
            setResult(data.result);
            setResultVideoId(data.video_id ?? null);
            showToast("Video summarized successfully!", "success");
          }
        } else if (data.status === "failed") {
          stopTracking();
          setUsageRefresh((n) => n + 1);
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

  /** Summarizing needs an account (it uses your daily videos). Visitors are sent to sign in and come back to this link. */
  const requireAccount = (pendingUrl?: string): boolean => {
    if (signedIn || !authConfigured) return false;
    try {
      if (pendingUrl) sessionStorage.setItem(PENDING_URL_KEY, pendingUrl);
    } catch {
      /* the link just has to be pasted again */
    }
    showToast("Sign in to summarize videos. It takes a few seconds.", "info");
    router.push("/login?next=%2F");
    return true;
  };

  const handleUrlSubmit = async (url: string, force: boolean = false) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (requireAccount(trimmed)) return;

    if (!navigator.onLine) {
      showToast("Cannot process video while offline. Please reconnect.", "error");
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
        setUsageRefresh((n) => n + 1);
        throw new Error(await readError(res, "Failed to start summarization"));
      }
      const data = await res.json();
      setUsageRefresh((n) => n + 1);

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
    if (requireAccount()) return;
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
        setUsageRefresh((n) => n + 1);
        throw new Error(await readError(res, "Failed to upload file"));
      }
      const data = await res.json();
      setUsageRefresh((n) => n + 1);

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

  // Back from signing in with a link waiting: continue where the visitor left off.
  const pendingHandled = useRef(false);
  useEffect(() => {
    if (!authReady || !signedIn || pendingHandled.current) return;
    pendingHandled.current = true;
    try {
      const pending = sessionStorage.getItem(PENDING_URL_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_URL_KEY);
        void handleUrlSubmit(pending);
      }
    } catch {
      /* no storage: nothing was saved */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, signedIn]);

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
          <UsageBadge refreshKey={usageRefresh} />
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
