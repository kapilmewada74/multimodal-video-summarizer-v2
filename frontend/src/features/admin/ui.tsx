"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

export const inputClass =
  "h-10 rounded-xl border border-[var(--card-border)] bg-[var(--bg-app)] px-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--brand-lime-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]";

export const buttonClass =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-4 text-sm font-bold text-[var(--text-main)] transition-all hover:bg-[var(--btn-secondary-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--text-main)]";

export const primaryButtonClass =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[var(--brand-lime)] px-4 text-sm font-bold text-[#0E0F0C] transition-all hover:bg-[var(--brand-lime-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--text-main)]";

export const dangerButtonClass =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-sm font-bold text-red-700 transition-all hover:bg-red-500/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300 focus-visible:ring-2 focus-visible:ring-red-500";

export function PageTitle({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
        {hint && <p className="mt-1 text-sm text-[var(--text-muted)]">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 sm:p-5 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-[var(--text-muted)]">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
      <p className="text-xs font-bold text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-black tracking-tight ${tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-main)]"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  neutral: "border-[var(--card-border)] bg-[var(--btn-secondary-bg)] text-[var(--text-muted)]",
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  brand: "border-[var(--brand-lime)]/50 bg-[var(--brand-lime)]/20 text-[var(--text-main)]",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof BADGE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${BADGE[tone]}`}>{children}</span>;
}

export function ErrorNote({ message }: { message: string }) {
  return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">{message}</p>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-12 text-center text-sm text-[var(--text-muted)]">{children}</p>;
}

/** Previous / next for a list that is loaded one page at a time. */
export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-sm text-[var(--text-muted)]">
      <span>{from}–{to} of {total}</span>
      <span className="flex gap-2">
        <button className={buttonClass} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <button className={buttonClass} disabled={offset + limit >= total} onClick={() => onChange(offset + limit)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </span>
    </nav>
  );
}

/** A search box that waits for a pause in typing before it tells the page (so each keystroke is not a request). */
export function SearchBox({ value, onSearch, placeholder, label }: { value: string; onSearch: (text: string) => void; placeholder: string; label: string }) {
  const [text, setText] = useState(value);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const timer = setTimeout(() => onSearch(text.trim()), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
      <input className={`${inputClass} w-full pl-9 sm:w-72`} type="search" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

export interface Query<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (next: T) => void;
}

/** Loads something when the page opens and whenever `key` changes. A slower, older answer never replaces a newer one. */
export function useQuery<T>(load: () => Promise<T>, key: string): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const mine = ++latest.current;
    setLoading(true);
    loader.current()
      .then((value) => { if (mine === latest.current) { setData(value); setError(null); } })
      .catch((err: unknown) => { if (mine === latest.current) setError(err instanceof Error ? err.message : "Could not load this."); })
      .finally(() => { if (mine === latest.current) setLoading(false); });
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
