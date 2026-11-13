"use client";

import React from "react";
import { RequireAuth } from "../../features/auth/RequireAuth";
import { Navbar } from "../../components/Navbar";
import { AccountOverview } from "../../features/account/AccountOverview";
import { useTheme } from "../../lib/useTheme";

export default function AccountPage() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-3xl px-3 py-8 sm:px-6">
        <RequireAuth><AccountOverview /></RequireAuth>
      </main>
    </div>
  );
}
