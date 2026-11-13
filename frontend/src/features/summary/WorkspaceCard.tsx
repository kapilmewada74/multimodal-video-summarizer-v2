"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Lock, PanelsTopLeft } from "lucide-react";

interface Props {
  /** Signed-in people go straight to the workspace. */
  href: string;
  /** Someone without an account sees the same card; pressing it opens the sign-in card instead. */
  locked: boolean;
  onLockedClick: () => void;
}

const BASE =
  "group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-left shadow-xs transition-all duration-200 " +
  "hover:-translate-y-0.5 hover:border-[var(--brand-lime-hover)] hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] sm:p-5";

/** "Open full workspace with video player": one clear card between the video preview and the study tabs. */
export function WorkspaceCard({ href, locked, onLockedClick }: Props) {
  const body = (
    <>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-lime)] text-[#0E0F0C] transition-transform duration-200 group-hover:scale-105 sm:h-14 sm:w-14">
        <PanelsTopLeft className="h-6 w-6 sm:h-7 sm:w-7" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-black tracking-tight text-[var(--text-main)] sm:text-lg">Open full workspace</span>
          {locked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
              <Lock className="h-3 w-3" /> Free account
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--text-muted)] sm:text-sm">
          {locked
            ? "Sign in to watch with the video player, take notes and keep this summary."
            : "Watch with the video player, take notes, track your study time and set goals."}
        </span>
      </span>
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] text-[var(--text-main)] transition-all duration-200 group-hover:border-transparent group-hover:bg-[var(--brand-lime)] group-hover:text-[#0E0F0C]"
      >
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </>
  );

  return locked ? (
    <button type="button" onClick={onLockedClick} className={`${BASE} cursor-pointer`} aria-label="Open full workspace with video player. Sign in required.">
      {body}
    </button>
  ) : (
    <Link href={href} className={BASE} aria-label="Open full workspace with video player">
      {body}
    </Link>
  );
}
