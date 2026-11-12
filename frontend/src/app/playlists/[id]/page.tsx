"use client";

import React from "react";
import { useParams } from "next/navigation";
import { RequireAuth } from "../../../features/auth/RequireAuth";
import { Navbar } from "../../../components/Navbar";
import { PlaylistDetail } from "../../../features/playlists/PlaylistDetail";
import { useTheme } from "../../../lib/useTheme";
import { useToast } from "../../../lib/useToast";

export default function PlaylistPage() {
  const params = useParams<{ id: string }>();
  const { theme, toggleTheme } = useTheme();
  const { showToast, toastView } = useToast();
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-3xl px-3 py-8 sm:px-6"><RequireAuth><PlaylistDetail playlistId={params.id} onToast={showToast} /></RequireAuth></main>
      {toastView}
    </div>
  );
}
