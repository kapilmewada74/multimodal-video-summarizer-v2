"use client";

import React from "react";
import { RequireAuth } from "../../features/auth/RequireAuth";
import { Navbar } from "../../components/Navbar";
import { PlaylistList } from "../../features/playlists/PlaylistList";
import { useTheme } from "../../lib/useTheme";
import { useToast } from "../../lib/useToast";

export default function PlaylistsPage() {
  const { theme, toggleTheme } = useTheme();
  const { showToast, toastView } = useToast();
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-3xl px-3 py-8 sm:px-6"><RequireAuth><PlaylistList onToast={showToast} /></RequireAuth></main>
      {toastView}
    </div>
  );
}
