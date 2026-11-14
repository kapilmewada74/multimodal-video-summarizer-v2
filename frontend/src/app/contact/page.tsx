"use client";

import React from "react";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";
import { ContactForm } from "../../features/support/ContactForm";
import { useTheme } from "../../lib/useTheme";

export default function ContactPage() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-3 py-10 sm:px-6">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Contact us</h1>
        <p className="mt-2 mb-8 text-sm text-[var(--text-muted)]">
          Questions, problems or ideas? Write to us and we will reply by email. You do not need an account.
        </p>
        <ContactForm />
      </main>
      <Footer />
    </div>
  );
}
