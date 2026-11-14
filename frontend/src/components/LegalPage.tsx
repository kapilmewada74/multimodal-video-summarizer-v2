import React from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { LEGAL_UPDATED, SITE } from "../lib/site";

/** The shared frame of the legal pages (server-rendered, no scripts needed). */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)]">
      <header className="border-b border-[var(--card-border)] bg-[var(--card-bg)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-extrabold text-sm tracking-tight">
            <Logo size={26} /> SUMMARIZE<span className="text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]">.AI</span>
          </Link>
          <nav className="flex gap-4 text-xs font-semibold text-[var(--text-muted)]">
            <Link href="/privacy" className="hover:text-[var(--text-main)]">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--text-main)]">Terms</Link>
            <Link href="/contact" className="hover:text-[var(--text-main)]">Contact</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-black tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:underline">
          {children}
        </div>
        <p className="mt-12 border-t border-[var(--card-border)] pt-4 text-xs text-[var(--text-muted)]">
          Questions? <Link href="/contact" className="underline">Contact us</Link>{SITE.contactEmail && <> or email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a></>}.
        </p>
      </main>
    </div>
  );
}
