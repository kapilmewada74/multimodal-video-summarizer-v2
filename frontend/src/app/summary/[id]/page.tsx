"use client";

import React from "react";
import { useParams } from "next/navigation";
import { Navbar } from "../../../components/Navbar";
import { SummaryResult } from "../../../features/summary/SummaryResult";
import { useTheme } from "../../../lib/useTheme";
import { useToast } from "../../../lib/useToast";

/** The result of one video, on its own page, so the home page stays as it was. Works for guests and accounts. */
export default function SummaryPage() {
  const params = useParams<{ id: string }>();
  const { theme, toggleTheme } = useTheme();
  const { showToast, toastView } = useToast();

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-[1180px] px-3 py-6 sm:px-6 sm:py-8">
        <SummaryResult videoId={params.id} onToast={showToast} />
      </main>
      {toastView}
    </div>
  );
}
