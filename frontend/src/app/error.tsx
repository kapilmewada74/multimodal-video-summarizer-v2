"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home, ChevronDown } from "lucide-react";
import { Logo } from "../components/Logo";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Sync theme
    const saved = (localStorage.getItem("theme") as "dark" | "light") || "light";
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(saved);
    // Log error to client console or monitoring service
    console.error("Unhandled client error in SUMMARIZE.AI:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-main)] transition-colors select-none">
      {/* Header */}
      <header className="h-16 border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur-md px-4 sm:px-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="font-extrabold text-base tracking-tight uppercase text-[var(--text-main)]">
            SUMMARIZE<span className="text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]">.AI</span>
          </span>
        </Link>
      </header>

      {/* Main Error Presentation */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-600 dark:text-red-400 mb-6">
            <AlertTriangle className="w-4 h-4" />
            <span>Error 500 • Application Exception</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-[var(--text-main)] mb-3">
            Something went wrong
          </h1>

          <p className="text-sm sm:text-base text-[var(--text-muted)] max-w-md mx-auto mb-6 leading-relaxed">
            An unexpected error occurred while executing the request. You can retry the operation or reset the application state.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
            <button
              onClick={() => reset()}
              className="h-11 px-6 rounded-full bg-[var(--brand-lime)] hover:bg-[var(--brand-lime-hover)] text-[#0E0F0C] font-bold text-sm inline-flex items-center gap-2 shadow-sm transition-all cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Try Again</span>
            </button>

            <Link
              href="/"
              onClick={() => window.location.href = "/"}
              className="h-11 px-6 rounded-full bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)] text-[var(--text-main)] border border-[var(--card-border)] font-semibold text-sm inline-flex items-center gap-2 transition-all active:scale-95"
            >
              <Home className="w-4 h-4" />
              <span>Reload App</span>
            </Link>
          </div>

          {/* Collapsible Error Technical Details */}
          <details className="text-left rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-xs group">
            <summary className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer flex items-center justify-between list-none">
              <span>View Technical Details</span>
              <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="mt-3 pt-3 border-t border-[var(--card-border)] font-mono text-[11px] text-red-600 dark:text-red-300 break-words leading-relaxed overflow-x-auto">
              <p className="font-bold mb-1">{error.message || "Unknown error"}</p>
              {error.digest && <p className="text-[var(--text-muted)]">Digest: {error.digest}</p>}
            </div>
          </details>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-14 border-t border-[var(--card-border)] flex items-center justify-center text-xs text-[var(--text-muted)]">
        <span>SUMMARIZE.AI System Resilience Handler</span>
      </footer>
    </div>
  );
}
