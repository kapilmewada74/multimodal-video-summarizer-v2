"use client";

import React from "react";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

/**
 * Base primitive skeleton block with smooth brand shimmer.
 * Automatically respects prefers-reduced-motion.
 */
export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return (
    <div
      className={`animate-shimmer rounded-xl bg-[var(--btn-secondary-bg)]/80 dark:bg-[var(--card-elevated)] ${className}`}
      {...props}
    />
  );
}

/**
 * Loading state for Active-Recall 3D Flashcards.
 * Matches flashcard proportions, tags, and navigation bar.
 */
export function FlashcardsSkeleton() {
  return (
    <div className="w-full py-4" aria-busy="true" aria-label="Loading study flashcards">
      {/* Top action row placeholder */}
      <div className="flex items-center justify-between mb-4 px-1">
        <Skeleton className="h-4 w-32 rounded-md" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-xl" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>

      {/* Main card deck skeleton scroll container */}
      <div className="flex items-center gap-5 overflow-x-hidden py-2 px-1">
        {[1, 2, 3].map((idx) => (
          <div
            key={idx}
            className="w-[280px] sm:w-[320px] h-[380px] shrink-0 rounded-3xl p-6 border border-[var(--card-border)] bg-[var(--card-bg)] shadow-md flex flex-col justify-between relative overflow-hidden"
          >
            {/* Ambient shimmer banner */}
            <div className="flex items-center justify-between mb-4">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>

            {/* Question Lines */}
            <div className="space-y-3 my-auto">
              <Skeleton className="h-5 w-5/6 rounded-md" />
              <Skeleton className="h-5 w-4/6 rounded-md" />
              <Skeleton className="h-4 w-full rounded-md opacity-60" />
              <Skeleton className="h-4 w-3/4 rounded-md opacity-60" />
            </div>

            {/* Card Footer */}
            <div className="pt-4 border-t border-[var(--card-border)] flex items-center justify-between">
              <Skeleton className="h-3 w-16 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading state for 16:9 Presentation Slides.
 * Replicates the widescreen keynote slide frame and split archetype.
 */
export function PresentationSkeleton() {
  return (
    <div className="w-full py-4 max-w-4xl mx-auto" aria-busy="true" aria-label="Loading presentation slides">
      {/* Top presentation toolbar */}
      <div className="flex items-center justify-between mb-4 px-2">
        <Skeleton className="h-6 w-48 rounded-lg" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      </div>

      {/* 16:9 Aspect Ratio Slide Canvas Skeleton */}
      <div className="w-full aspect-video rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-10 shadow-lg flex flex-col justify-between relative overflow-hidden">
        {/* Slide Header: Kicker + Title */}
        <div className="space-y-3">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="h-8 sm:h-10 w-3/4 rounded-xl" />
        </div>

        {/* Split Body: Left Image Box + Right Bullet List */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 my-auto items-center">
          <div className="md:col-span-5 h-36 sm:h-44 rounded-2xl overflow-hidden">
            <Skeleton className="w-full h-full rounded-2xl" />
          </div>
          <div className="md:col-span-7 space-y-3">
            <Skeleton className="h-4 w-full rounded-md" />
            <Skeleton className="h-4 w-11/12 rounded-md" />
            <Skeleton className="h-4 w-4/5 rounded-md" />
            <Skeleton className="h-4 w-2/3 rounded-md" />
          </div>
        </div>

        {/* Slide Footer: Page Number & Meta */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--card-border)]">
          <Skeleton className="h-3 w-28 rounded-md" />
          <Skeleton className="h-3 w-12 rounded-md" />
        </div>
      </div>

      {/* Slide Navigation Dots */}
      <div className="flex items-center justify-center gap-2 mt-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="w-2.5 h-2.5 rounded-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Loading state for Interactive Adaptive Quizzes.
 * Displays question counter, prompt skeleton, and 4 option buttons.
 */
export function QuizSkeleton() {
  return (
    <div className="w-full max-w-2xl mx-auto py-4" aria-busy="true" aria-label="Loading interactive quiz">
      {/* Quiz Progress Header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <Skeleton className="h-4 w-28 rounded-md" />
        <Skeleton className="h-4 w-16 rounded-md" />
      </div>
      <Skeleton className="h-2 w-full rounded-full mb-6" />

      {/* Main Question Box */}
      <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 sm:p-8 shadow-md">
        <div className="space-y-2.5 mb-8">
          <Skeleton className="h-6 w-full rounded-lg" />
          <Skeleton className="h-6 w-4/5 rounded-lg" />
          <Skeleton className="h-4 w-2/3 rounded-md opacity-60 mt-1" />
        </div>

        {/* 4 Multiple Choice Options */}
        <div className="space-y-3">
          {[1, 2, 3, 4].map((opt) => (
            <div
              key={opt}
              className="h-14 rounded-2xl border border-[var(--card-border)] bg-[var(--btn-secondary-bg)]/40 px-4 flex items-center gap-3.5"
            >
              <Skeleton className="w-7 h-7 rounded-lg shrink-0" />
              <Skeleton className="h-4 w-3/4 rounded-md" />
            </div>
          ))}
        </div>

        {/* Action Button Row */}
        <div className="flex justify-between items-center mt-8 pt-4 border-t border-[var(--card-border)]">
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Loading state for Structured Summary / Study Notes Workspace.
 * Includes heading, paragraphs, bullets, and a mock LaTeX formula block.
 */
export function SummarySkeleton() {
  return (
    <div className="w-full space-y-6 py-2" aria-busy="true" aria-label="Loading video summary">
      {/* Title & Action Bar Skeleton */}
      <div className="flex items-center justify-between pb-4 border-b border-[var(--card-border)]">
        <Skeleton className="h-7 w-52 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
      </div>

      {/* Main Topic Section */}
      <div className="space-y-3">
        <Skeleton className="h-6 w-40 rounded-lg" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="h-4 w-11/12 rounded-md" />
        <Skeleton className="h-4 w-4/5 rounded-md" />
      </div>

      {/* Mock Mathematical Equation / Formula Block */}
      <div className="p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-elevated)] flex flex-col items-center justify-center gap-2 py-6">
        <Skeleton className="h-6 w-64 rounded-md" />
        <Skeleton className="h-3 w-40 rounded-md opacity-60" />
      </div>

      {/* Key Concepts Bullets */}
      <div className="space-y-3 pt-2">
        <Skeleton className="h-6 w-44 rounded-lg" />
        <div className="space-y-2.5 pl-4 border-l-2 border-[var(--card-border)]">
          <Skeleton className="h-4 w-10/12 rounded-md" />
          <Skeleton className="h-4 w-9/12 rounded-md" />
          <Skeleton className="h-4 w-11/12 rounded-md" />
          <Skeleton className="h-4 w-8/12 rounded-md" />
        </div>
      </div>
    </div>
  );
}

/**
 * Loading state for tabular data / comparison tables.
 */
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="w-full rounded-2xl border border-[var(--card-border)] overflow-hidden bg-[var(--card-bg)]">
      {/* Table Header */}
      <div className="grid grid-cols-3 gap-4 p-4 bg-[var(--card-elevated)] border-b border-[var(--card-border)]">
        <Skeleton className="h-4 w-24 rounded-md" />
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="h-4 w-28 rounded-md" />
      </div>
      {/* Table Rows */}
      <div className="divide-y divide-[var(--card-border)]">
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="grid grid-cols-3 gap-4 p-4 items-center">
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="h-4 w-48 rounded-md" />
            <Skeleton className="h-4 w-32 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Accessible Semantic Loading Spinner adhering to modern web guidelines.
 * Uses native <progress> element with prefers-reduced-motion fallback.
 */
export function SemanticSpinner({
  size = "md",
  label = "Loading",
}: {
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const sizeMap = {
    sm: "w-4 h-4 border-2",
    md: "w-5 h-5 border-2",
    lg: "w-8 h-8 border-3",
  };

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-busy="true"
      className={`inline-block ${sizeMap[size]} rounded-full border-[var(--card-border)] border-t-[var(--brand-lime-hover)] dark:border-t-[var(--brand-lime)] animate-spin shrink-0`}
    />
  );
}
