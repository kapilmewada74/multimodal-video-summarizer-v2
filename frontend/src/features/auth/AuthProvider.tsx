"use client";

import { track } from "../../lib/analytics";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { setTokenProvider } from "../../lib/api";
import { getSupabase, isSupabaseConfigured } from "../../lib/supabase";
import { callbackUrl, hasGoogle, profileOf, safeNext, sendEmailLink, signInErrorMessage, startGoogleSignIn, type Profile } from "./session";

interface AuthState {
  /** The first session check has finished. */
  ready: boolean;
  /** Supabase keys are present in the environment. */
  configured: boolean;
  signedIn: boolean;
  /** Signing out is in progress: pages should not bounce the person to the login page on the way home. */
  signingOut: boolean;
  session: Session | null;
  profile: Profile;
  /** Convenience: the account's email address, if it has one. */
  email: string | null;
  usesGoogle: boolean;
  /** Goes to Google and comes back to `next`. Throws a message that can be shown to the person. */
  signInWithGoogle: (next?: string) => Promise<void>;
  /** Emails a one-time sign-in link. Throws a message that can be shown to the person. */
  signInWithEmail: (email: string, next?: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const router = useRouter();
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!configured);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    setTokenProvider({
      getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      refreshToken: async () => (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
    });

    let cancelled = false;
    // Reading the saved session also finishes a Google or email-link sign-in that just came back to this page.
    supabase.auth
      .getSession()
      .then(({ data }) => !cancelled && setSession(data.session))
      .catch(() => undefined)
      .finally(() => !cancelled && setReady(true));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (next?: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Sign-in is not set up yet.");
    track("sign_in_started", { method: "google" });
    try {
      await startGoogleSignIn(supabase, callbackUrl(window.location.origin, safeNext(next)));
    } catch (err) {
      throw new Error(signInErrorMessage(err));
    }
  }, []);

  const signInWithEmail = useCallback(async (email: string, next?: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error("Sign-in is not set up yet.");
    track("sign_in_started", { method: "email" });
    try {
      await sendEmailLink(supabase, email, callbackUrl(window.location.origin, safeNext(next)));
    } catch (err) {
      throw new Error(signInErrorMessage(err));
    }
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    router.replace("/");                          // go home first, so a protected page does not send us to the login page
    await getSupabase()?.auth.signOut();
    setSession(null);
  }, [router]);

  // Arrived home: signing out is finished.
  useEffect(() => {
    if (signingOut && pathname === "/") setSigningOut(false);
  }, [signingOut, pathname]);

  const value = useMemo<AuthState>(() => {
    const profile = profileOf(session);
    return {
      ready, configured, signedIn: Boolean(session), signingOut, session, profile, email: profile.email,
      usesGoogle: hasGoogle(session), signInWithGoogle, signInWithEmail, signOut,
    };
  }, [ready, configured, session, signingOut, signInWithGoogle, signInWithEmail, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
