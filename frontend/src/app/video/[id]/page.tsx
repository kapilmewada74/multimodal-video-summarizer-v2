"use client";

import React from "react";
import { useParams } from "next/navigation";
import { RequireAuth } from "../../../features/auth/RequireAuth";
import { Navbar } from "../../../components/Navbar";
import { VideoWorkspace } from "../../../features/workspace/VideoWorkspace";
import { useTheme } from "../../../lib/useTheme";
import { useToast } from "../../../lib/useToast";

export default function VideoPage() {
  const params = useParams<{ id: string }>();
  const { theme, toggleTheme } = useTheme();
  const { showToast, toastView } = useToast();

  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-[1700px] px-3 py-6 sm:px-6 sm:py-8">
        <RequireAuth><VideoWorkspace videoId={params.id} onToast={showToast} /></RequireAuth>
      </main>
      {toastView}
    </div>
  );
}
