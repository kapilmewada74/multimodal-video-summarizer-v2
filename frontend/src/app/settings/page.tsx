"use client";

import React from "react";
import { RequireAuth } from "../../features/auth/RequireAuth";
import { Navbar } from "../../components/Navbar";
import { NotificationSettings } from "../../features/notifications/NotificationSettings";
import { useTheme } from "../../lib/useTheme";
import { useToast } from "../../lib/useToast";

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { showToast, toastView } = useToast();
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-3xl px-3 py-8 sm:px-6"><RequireAuth><NotificationSettings onToast={showToast} /></RequireAuth></main>
      {toastView}
    </div>
  );
}
