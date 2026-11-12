"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { Home, HelpCircle, AlertCircle, ArrowRight } from "lucide-react";
import { Logo } from "../components/Logo";

export default function NotFound() {
  useEffect(() => {
    const saved = (localStorage.getItem("theme") as "dark" | "light") || "light";
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(saved);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-app)] text-[var(--text-main)] transition-colors select-none">
      {/* Simple Header */}
      <header className="h-16 border-b border-[var(--card-border)] bg-[var(--card-bg)]/80 backdrop-blur-md px-4 sm:px-8 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] rounded-lg p-1"
          aria-label="SUMMARIZE.AI Home"
        >
          <Logo size={28} />
          <span className="font-extrabold text-base tracking-tight uppercase text-[var(--text-main)]">
            SUMMARIZE<span className="text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]">.AI</span>
          </span>
        </Link>
      </header>

      {/* Main 404 Content */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--brand-lime)]/15 border border-[var(--brand-lime)]/30 text-xs font-bold text-[var(--text-main)] mb-6">
            <AlertCircle className="w-4 h-4 text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]" />
            <span>Error 404 • Resource Not Found</span>
          </div>

          {/* Large Stylized 404 */}
          <h1 className="text-6xl sm:text-7xl md:text-8xl font-black tracking-tighter text-[var(--text-main)] mb-3">
            4<span className="text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]">0</span>4
          </h1>

          <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-main)] mb-3">
            The page you are looking for does not exist
          </h2>

          <p className="text-sm sm:text-base text-[var(--text-muted)] max-w-md mx-auto mb-8 leading-relaxed">
            The link you followed may be broken, or the page may have been moved. Return to the home workspace to summarize videos.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="h-11 px-6 rounded-full bg-[var(--brand-lime)] hover:bg-[var(--brand-lime-hover)] text-[#0E0F0C] font-bold text-sm inline-flex items-center gap-2 shadow-xs hover:shadow-md transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
            >
              <Home className="w-4 h-4" />
              <span>Back to Home</span>
            </Link>

            <Link
              href="/#faq"
              className="h-11 px-6 rounded-full bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)] text-[var(--text-main)] border border-[var(--card-border)] font-semibold text-sm inline-flex items-center gap-2 transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
            >
              <HelpCircle className="w-4 h-4" />
              <span>View FAQ</span>
            </Link>
          </div>

          {/* Quick Helpful Shortcuts */}
          <div className="mt-12 pt-8 border-t border-[var(--card-border)] grid grid-cols-2 gap-3 text-left">
            <Link
              href="/#features"
              className="p-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--btn-secondary-bg)] transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
            >
              <p className="text-xs font-bold text-[var(--text-main)] group-hover:text-[var(--brand-lime-hover)] dark:group-hover:text-[var(--brand-lime)] flex items-center justify-between">
                <span>Core Features</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Explore multimodal study notes & tools
              </p>
            </Link>

            <Link
              href="/#how-it-works"
              className="p-3.5 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--btn-secondary-bg)] transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
            >
              <p className="text-xs font-bold text-[var(--text-main)] group-hover:text-[var(--brand-lime-hover)] dark:group-hover:text-[var(--brand-lime)] flex items-center justify-between">
                <span>How It Works</span>
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                YouTube & audio upload workflow
              </p>
            </Link>
          </div>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="h-14 border-t border-[var(--card-border)] flex items-center justify-center text-xs text-[var(--text-muted)]">
        <span>© {new Date().getFullYear()} SUMMARIZE.AI • Educational Video Intelligence</span>
      </footer>
    </div>
  );
}
