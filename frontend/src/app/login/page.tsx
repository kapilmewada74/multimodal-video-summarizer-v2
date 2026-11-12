"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { Logo } from "../../components/Logo";
import { useAuth } from "../../features/auth/AuthProvider";
import { isValidEmail, safeNext } from "../../features/auth/session";
import { useTheme } from "../../lib/useTheme";

const RESEND_SECONDS = 60;

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function LoginForm() {
  const { ready, configured, signedIn, signInWithGoogle, signInWithEmail } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "Sign-in did not finish. Please try again." : null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  // Already signed in: carry on to where they were going.
  useEffect(() => {
    if (ready && signedIn) router.replace(next);
  }, [ready, signedIn, next, router]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const google = async () => {
    setError(null);
    setBusy("google");
    try {
      await signInWithGoogle(next); // the page leaves for Google, so there is nothing more to do here
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in did not work.");
      setBusy(null);
    }
  };

  const sendLink = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!isValidEmail(email)) return setError("Enter a valid email address.");
    setError(null);
    setBusy("email");
    try {
      await signInWithEmail(email, next);
      setSentTo(email.trim().toLowerCase());
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the link.");
    } finally {
      setBusy(null);
    }
  };

  if (!configured) {
    return <p role="alert" className="text-center text-sm text-[var(--text-muted)]">Sign-in is not set up for this app yet.</p>;
  }

  if (sentTo) {
    return (
      <div className="text-center" role="status">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-lime)]/30"><Mail className="h-6 w-6" /></span>
        <h2 className="text-xl font-black tracking-tight">Check your email</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">We sent a sign-in link to <strong className="text-[var(--text-main)]">{sentTo}</strong>. Open it on this device to finish. It works once and expires soon.</p>
        <div className="mt-5 flex flex-col items-center gap-2 text-sm">
          <button type="button" onClick={() => void sendLink()} disabled={wait > 0 || busy !== null} className="font-bold underline disabled:no-underline disabled:opacity-50 cursor-pointer">
            {wait > 0 ? `Send again in ${wait}s` : "Send the link again"}
          </button>
          <button type="button" onClick={() => { setSentTo(null); setError(null); }} className="text-[var(--text-muted)] underline cursor-pointer">Use a different email</button>
        </div>
        {error && <p role="alert" className="mt-4 text-sm text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-center text-2xl font-black tracking-tight">Sign in to SUMMARIZE.AI</h1>
      <p className="mt-2 text-center text-sm text-[var(--text-muted)]">Your library, notes and study progress stay with your account on every device.</p>

      <button
        type="button" onClick={() => void google()} disabled={busy !== null}
        className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] text-sm font-bold shadow-sm hover:border-[var(--brand-lime)] disabled:opacity-60 cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
      >
        {busy === "google" ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleMark />}
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-xs text-[var(--text-muted)]" role="separator"><span className="h-px flex-1 bg-[var(--card-border)]" />or<span className="h-px flex-1 bg-[var(--card-border)]" /></div>

      <form onSubmit={sendLink} noValidate>
        <label htmlFor="login-email" className="mb-1.5 block text-xs font-bold text-[var(--text-muted)]">Email address</label>
        <input
          id="login-email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          aria-invalid={error && !busy ? true : undefined} aria-describedby={error ? "login-error" : undefined}
          className="h-12 w-full rounded-2xl border border-[var(--card-border)] bg-[var(--bg-app)] px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
        />
        <button
          type="submit" disabled={busy !== null || !email.trim()}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--brand-lime)] text-sm font-black text-[#0E0F0C] disabled:opacity-50 cursor-pointer active:scale-[0.99]"
        >
          {busy === "email" && <Loader2 className="h-4 w-4 animate-spin" />}
          Email me a sign-in link
        </button>
      </form>

      {error && <p id="login-error" role="alert" className="mt-4 text-center text-sm text-rose-600">{error}</p>}
      <p className="mt-6 text-center text-xs text-[var(--text-muted)]">No password to remember. New here? Signing in creates your account.</p>
    </div>
  );
}

export default function LoginPage() {
  useTheme(); // applies the saved light or dark theme to this page too
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-app)] text-[var(--text-main)]">
      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg p-1 focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]" aria-label="SUMMARIZE.AI home">
          <Logo size={30} /><span className="text-sm font-extrabold uppercase tracking-tight sm:text-base">SUMMARIZE<span className="text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]">.AI</span></span>
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]"><ArrowLeft className="h-4 w-4" /> Home</Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm rounded-3xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 shadow-sm sm:p-8">
          <Suspense fallback={<div role="status" className="py-16 text-center text-sm text-[var(--text-muted)]">Loading…</div>}>
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
