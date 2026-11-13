"use client";

import React, { useEffect, useState, useMemo } from "react";
import { Check, Mic, Lightbulb, FileText } from "lucide-react";
import { JobState } from "../lib/types";

interface GeneratingProgressCardProps {
  job: JobState;
}

export function GeneratingProgressCard({ job }: GeneratingProgressCardProps) {
  // Real-time display progress tracking backend directly
  const [displayProgress, setDisplayProgress] = useState<number>(() =>
    Math.max(job.progress || 0, 10)
  );

  useEffect(() => {
    if (job.status === "completed") {
      setDisplayProgress(100);
      return;
    }
    const realProgress = Math.max(job.progress || 0, 10);
    setDisplayProgress((prev) => Math.max(prev, realProgress));
  }, [job.progress, job.status]);

  // Compute active stage dynamically in REAL TIME from actual backend state
  // 1: Transcribing audio
  // 2: Extracting key concepts
  // 3: Generating summary
  // 4: Completed (all checked)
  const activeStage = useMemo(() => {
    if (job.status === "completed" || (job.progress && job.progress >= 100)) {
      return 4;
    }

    const msg = (job.message || "").toLowerCase();
    const stepName = (job.step_name || "").toLowerCase();
    const progress = job.progress || 0;

    // Stage 3: AI Summarization (Groq / Gemini synthesizing structured summary)
    if (
      job.step >= 3 ||
      progress >= 70 ||
      stepName.includes("summariz") ||
      msg.includes("groq") ||
      msg.includes("gemini") ||
      msg.includes("synthesiz")
    ) {
      return 3;
    }

    // Stage 2: Extracting key concepts / formatting transcript
    if (
      (progress >= 50 && !msg.includes("whisper") && !msg.includes("transcribing")) ||
      stepName.includes("formatting") ||
      stepName.includes("concept") ||
      msg.includes("formatting") ||
      msg.includes("concept") ||
      msg.includes("chunks")
    ) {
      return 2;
    }

    // Stage 1: Audio extraction and speech transcription
    return 1;
  }, [job.status, job.step, job.step_name, job.progress, job.message]);

  // Stages configuration matching UI Image 4
  const stages = [
    {
      id: 1,
      name: "Transcribing audio",
      shortName: "Transcription",
      icon: Mic,
    },
    {
      id: 2,
      name: "Extracting key concepts",
      shortName: "Key Concepts",
      icon: Lightbulb,
    },
    {
      id: 3,
      name: "Generating summary",
      shortName: "Generating summary",
      icon: FileText,
    },
  ];

  // Dynamic status subtitle reflecting actual pipeline work without vendor tech names
  const dynamicSubtitle = useMemo(() => {
    let raw = job.message || "";
    // Clean out vendor engine / model references
    raw = raw
      .replace(/\s*(with|using)\s+Groq\s*(AI)?/gi, "")
      .replace(/\s*(with|for)\s+Faster-Whisper/gi, "")
      .replace(/\s*(with|using)\s+local AI model/gi, "")
      .trim();

    if (raw && !raw.toLowerCase().includes("processing task...")) {
      return raw;
    }
    if (activeStage === 1) {
      return "Transcribing speech from audio track...";
    }
    if (activeStage === 2) {
      return "Extracting core concepts, principles, and structured highlights...";
    }
    return "Generating structured study summary in seconds...";
  }, [activeStage, job.message]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="w-full max-w-2xl mx-auto mt-2 sm:mt-4 mb-20 sm:mb-28 lg:mb-32 p-6 sm:p-9 rounded-3xl bg-[var(--card-bg)] border border-[var(--card-border)] shadow-sm text-center relative overflow-hidden transition-all duration-300 no-print"
    >
      {/* Ambient Radial Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-36 bg-[var(--brand-lime)]/15 dark:hidden blur-3xl rounded-full pointer-events-none -z-0" />

      {/* Progress Headline & Real-Time Contextual Status */}
      <div className="mt-2 mb-7 relative z-10">
        <h3 className="text-lg sm:text-xl font-extrabold text-[var(--text-main)] tracking-tight">
          Understanding your video...
        </h3>
        <p className="text-xs sm:text-sm text-[var(--text-muted)] mt-1.5 max-w-md mx-auto line-clamp-1 transition-all">
          {dynamicSubtitle}
        </p>
      </div>

      {/* ============================================================
          THREE-STAGE PROGRESS INDICATOR
          ============================================================ */}
      <div className="w-full max-w-lg mx-auto relative z-10 px-1 sm:px-3">
        <div className="flex items-center justify-between relative">
          {/* Step 1 to Step 2 Track */}
          <div
            className="absolute top-4 sm:top-4.5 left-[16%] right-[50%] h-[2px] -translate-y-1/2 z-0 transition-all duration-300"
            style={{
              background:
                activeStage > 1
                  ? "var(--brand-lime)"
                  : activeStage === 1
                  ? "linear-gradient(to right, var(--brand-lime), var(--card-border))"
                  : "var(--card-border)",
            }}
          />

          {/* Step 2 to Step 3 Track */}
          <div
            className="absolute top-4 sm:top-4.5 left-[50%] right-[16%] h-[2px] -translate-y-1/2 z-0 transition-all duration-300"
            style={{
              background:
                activeStage > 2
                  ? "var(--brand-lime)"
                  : activeStage === 2
                  ? "linear-gradient(to right, var(--brand-lime), var(--card-border))"
                  : "var(--card-border)",
            }}
          />

          {/* Render 3 Stage Nodes */}
          {stages.map((stage) => {
            const isCompleted = activeStage > stage.id;
            const isActive = activeStage === stage.id;

            return (
              <div
                key={stage.id}
                className="flex flex-col items-center flex-1 relative z-10 px-1"
              >
                {/* Node Circle */}
                <div className="relative mb-2.5">
                  {/* Ping effect on active stage */}
                  {isActive && (
                    <span className="absolute -inset-1 rounded-full bg-[var(--brand-lime)]/40 animate-ping pointer-events-none" />
                  )}

                  <div
                    className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                      isCompleted
                        ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-sm font-black"
                        : isActive
                        ? "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-md ring-4 ring-[var(--brand-lime)]/20 font-black scale-105"
                        : "border border-[var(--card-border)] bg-[var(--card-elevated)] text-[var(--text-muted)] text-xs font-semibold"
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="w-4 h-4 stroke-[3]" />
                    ) : isActive ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-[#0A0A0A] animate-pulse" />
                    ) : (
                      <span>{stage.id}</span>
                    )}
                  </div>
                </div>

                {/* Stage Label */}
                <span
                  className={`text-[11px] sm:text-xs text-center transition-colors leading-tight ${
                    isCompleted
                      ? "font-semibold text-[var(--text-main)]"
                      : isActive
                      ? "font-bold text-[var(--text-main)] dark:text-white"
                      : "font-normal text-[var(--text-muted)] opacity-60"
                  }`}
                >
                  <span className="hidden sm:inline">{stage.name}</span>
                  <span className="sm:hidden">{stage.shortName}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============================================================
          SLIM PROGRESS BAR & PERCENTAGE FOOTER
          ============================================================ */}
      <div className="w-full max-w-lg mx-auto mt-7 pt-4 border-t border-[var(--card-border)]/50 relative z-10">
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-1.5">
          <span className="font-semibold text-[var(--text-main)]">
            Processing
          </span>
          <span className="font-mono font-bold text-[var(--text-main)]">
            {Math.round(displayProgress)}%
          </span>
        </div>
        <div className="w-full h-1.5 bg-[var(--card-border)]/40 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--brand-lime)] rounded-full transition-all duration-500 ease-out animate-shimmer"
            style={{ width: `${Math.max(6, Math.min(100, Math.round(displayProgress)))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
