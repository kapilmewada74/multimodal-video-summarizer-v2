"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";

/**
 * Wraps a page that needs an account. Signed-out visitors are sent to the login page and brought back
 * to this page afterwards. While the saved session is being read, a spinner shows (never a flash of the page).
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, configured, signedIn, signingOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (configured && ready && !signedIn && !signingOut) {
      // The query string is read from the address bar (useSearchParams would force every page to be built dynamically).
      const here = `${pathname ?? "/"}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [configured, ready, signedIn, signingOut, pathname, router]);

  if (!configured) {
    return (
      <div role="alert" className="mx-auto max-w-md px-4 py-24 text-center text-sm text-[var(--text-muted)]">
        Sign-in is not set up for this app yet. <Link href="/" className="font-bold underline">Back to the home page</Link>
      </div>
    );
  }
  if (!ready || !signedIn) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-32 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> {ready ? "Taking you to sign in…" : "Loading…"}
      </div>
    );
  }
  return <>{children}</>;
}
