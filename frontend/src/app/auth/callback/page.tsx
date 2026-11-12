"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../features/auth/AuthProvider";
import { safeNext } from "../../../features/auth/session";

const GIVE_UP_MS = 12_000;

/** Where Google and email links return to. The saved session is read by the provider; then we go on. */
function Finish() {
  const { ready, signedIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  // Supabase reports problems in the address (for example an expired link).
  const [hashError, setHashError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const description = params.get("error_description") ?? hash.get("error_description");
    if (description) setHashError(description.replace(/\+/g, " "));
  }, [params]);

  useEffect(() => {
    if (ready && signedIn) router.replace(next);
  }, [ready, signedIn, next, router]);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);

  const failed = Boolean(hashError) || (timedOut && !signedIn);
  if (failed) {
    return (
      <div role="alert" className="text-center">
        <h1 className="text-xl font-black">We could not sign you in</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          {hashError && /expired|invalid/i.test(hashError) ? "That link has expired or was already used." : "The sign-in did not finish."} Please try again.
        </p>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="mt-5 inline-block rounded-full bg-[var(--brand-lime)] px-6 py-2.5 text-sm font-black text-[#0E0F0C]">Back to sign in</Link>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-col items-center gap-3 text-sm text-[var(--text-muted)]">
      <Loader2 className="h-6 w-6 animate-spin" /> Signing you in…
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-app)] px-4 text-[var(--text-main)]">
      <Suspense fallback={null}><Finish /></Suspense>
    </main>
  );
}
