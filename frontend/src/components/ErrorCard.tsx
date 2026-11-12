"use client";

import React from "react";
import { AlertCircle, RefreshCw, X, FileVideo, Youtube, HelpCircle } from "lucide-react";

interface ErrorCardProps {
  error?: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorCard({ error, onRetry, onDismiss }: ErrorCardProps) {
  const errorMessage = error || "An unexpected error occurred while processing the video.";

  return (
    <div className="w-full max-w-2xl mx-auto my-8 sm:my-10 p-6 sm:p-8 rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-sm transition-all relative overflow-hidden no-print">
      {/* Subtle ambient accent glow */}
      <div className="absolute top-0 right-0 w-64 h-32 bg-red-500/[0.04] dark:bg-red-500/[0.06] blur-3xl rounded-full pointer-events-none -z-0" />

      <div className="flex items-start gap-4 sm:gap-5 relative z-10">
        {/* Status Icon Badge */}
        <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0 text-red-600 dark:text-red-400">
          <AlertCircle className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base sm:text-lg font-bold text-[var(--text-main)] tracking-tight">
              Summarization Encountered an Issue
            </h3>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Clean Website-styled Error Message Callout */}
          <div className="mt-3 p-3.5 sm:p-4 rounded-2xl bg-[var(--card-elevated)] border border-[var(--card-border)] break-words leading-relaxed">
            <div className="flex items-start gap-2.5">
              <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
              <p className="font-mono text-xs sm:text-sm text-[var(--text-main)]">
                {errorMessage}
              </p>
            </div>
          </div>

          {/* Helpful Troubleshooting Steps */}
          <div className="mt-4 pt-3.5 border-t border-[var(--card-border)]">
            <p className="text-[11px] font-bold text-[var(--text-muted)] tracking-wider uppercase mb-2.5">
              Troubleshooting Suggestions
            </p>
            <ul className="space-y-2 text-xs text-[var(--text-muted)] leading-relaxed">
              <li className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md bg-[var(--btn-secondary-bg)] flex items-center justify-center shrink-0 text-[var(--text-main)]">
                  <Youtube className="w-3 h-3" />
                </div>
                <span>Verify that the video is public and not private or age-restricted.</span>
              </li>
              <li className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md bg-[var(--btn-secondary-bg)] flex items-center justify-center shrink-0 text-[var(--text-main)]">
                  <FileVideo className="w-3 h-3" />
                </div>
                <span>Ensure the video has audible speech or automated captions.</span>
              </li>
              <li className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-md bg-[var(--btn-secondary-bg)] flex items-center justify-center shrink-0 text-[var(--text-main)]">
                  <HelpCircle className="w-3 h-3" />
                </div>
                <span>Supported file formats include .mp4, .mov, .mp3, .wav, and .m4a.</span>
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="h-10 px-5 rounded-full bg-[var(--brand-lime)] hover:bg-[var(--brand-lime-hover)] active:scale-95 text-[#0E0F0C] font-black text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
              >
                <RefreshCw className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Try Again</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="h-10 px-4 rounded-full bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)] text-[var(--text-main)] border border-[var(--card-border)] text-xs sm:text-sm font-bold transition-all cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
            >
              Enter Another Video
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
