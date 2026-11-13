"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { track } from "../../lib/analytics";
import { useAuth } from "../auth/AuthProvider";
import { canShowNudge, handledThisSession, loadNudgeState, markHandledThisSession, noteDismissed } from "./nudge";

const PERKS = ["Keep your summaries and come back to them", "Video player with notes and study timer", "Playlists, documents and study goals"];

interface CardProps {
  title?: string;
  message?: string;
  /** Where to land after signing in. Defaults to the page the person is on. */
  next?: string;
  onClose: () => void;
}

/**
 * A small, non-blocking card in the corner (a bottom sheet on phones). The page behind it stays usable.
 * Signing in as a guest keeps what the guest made: it is added to the same account.
 */
export function SignInCard({ title = "Save your progress", message, next, onClose: closed }: CardProps) {
  const { signInWithGoogle } = useAuth();
  // Closing it by any route (cross, Escape, "Maybe later") counts: the reminder does not come back on other pages.
  const onClose = React.useCallback(() => {
    noteDismissed();
    track("signin_prompt_dismissed");
    closed();
  }, [closed]);
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = next ?? pathname ?? "/";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    track("signin_prompt_accepted");
    try {
      await signInWithGoogle(target);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Sign-in did not work. Please try again.");
    }
  };

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={title}
      className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-300 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[22rem]"
    >
      <button onClick={onClose} aria-label="Close" className="absolute right-2.5 top-2.5 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)] cursor-pointer">
        <X className="h-4 w-4" />
      </button>
      <h2 className="pr-8 text-base font-black tracking-tight text-[var(--text-main)]">{title}</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{message ?? "Sign in free to keep this summary and unlock the full workspace."}</p>
      <ul className="mt-3 space-y-1.5 text-xs text-[var(--text-main)]">
        {PERKS.map((perk) => (
          <li key={perk} className="flex items-start gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]" /> {perk}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-xs font-semibold text-[var(--color-danger)]">{error}</p>}
      <button
        onClick={() => void accept()}
        disabled={busy}
        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-lime)] text-sm font-black text-[#0E0F0C] transition-all hover:bg-[var(--brand-lime-hover)] disabled:opacity-60 cursor-pointer active:scale-[0.98]"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Continue with Google
      </button>
      <div className="mt-2 flex items-center justify-between text-xs">
        <Link href={`/login?next=${encodeURIComponent(target)}`} className="font-semibold text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-main)]">
          Use email instead
        </Link>
        <button onClick={onClose} className="font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">Maybe later</button>
      </div>
    </aside>
  );
}

/**
 * The gentle reminder: shows once, after `delayMs`, to people without an account, and respects earlier dismissals.
 * It is only mounted on pages where the person has already seen a result.
 */
export function SignInNudge({ delayMs = 8_000 }: { delayMs?: number }) {
  const { ready, configured, signedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const eligible = ready && configured && !signedIn;

  useEffect(() => {
    if (!eligible || handledThisSession() || !canShowNudge(loadNudgeState(), Date.now())) return;
    const timer = setTimeout(() => {
      if (handledThisSession()) return;      // another page's copy showed it, or it was dismissed, while we waited
      markHandledThisSession();              // shown once per visit, whatever the person does next
      setOpen(true);
      track("signin_prompt_shown");
    }, delayMs);
    return () => clearTimeout(timer);
  }, [eligible, delayMs]);

  if (!eligible || !open) return null;
  return <SignInCard onClose={() => setOpen(false)} />;
}
