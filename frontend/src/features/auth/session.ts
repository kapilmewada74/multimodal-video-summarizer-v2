import type { Session, SupabaseClient } from "@supabase/supabase-js";

type AuthClient = Pick<SupabaseClient, "auth">;

/**
 * Where to go after signing in. Only a path inside this site is accepted, so a crafted link such as
 * `/login?next=https://evil.example` or `//evil.example` can never send someone elsewhere.
 */
export function safeNext(next: string | null | undefined, fallback = "/library"): string {
  if (!next) return fallback;
  let value = next.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  if (value.startsWith("/login") || value.startsWith("/auth/")) return fallback;   // never loop back into the sign-in pages
  return value;
}

/** The address Supabase sends people back to after Google or an email link. It must be allowed in the Supabase dashboard. */
export function callbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/** Starts "Continue with Google". The browser is sent to Google and comes back to `redirectTo`. */
export async function startGoogleSignIn(supabase: AuthClient, redirectTo: string, scopes?: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, ...(scopes ? { scopes } : {}), queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}

/** Emails a one-time sign-in link (creating the account the first time). */
export async function sendEmailLink(supabase: AuthClient, email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
  });
  if (error) throw error;
}

/** A guest is someone using the free try-out (an anonymous Supabase session) who has not signed in yet. */
export function isGuestSession(session: Session | null): boolean {
  return Boolean(session?.user?.is_anonymous);
}

/** Opens a guest session for the free try-out. Nothing is asked of the person. */
export async function startGuestSession(supabase: AuthClient): Promise<Session> {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) throw error ?? new Error("no session");
  return data.session;
}

/**
 * A guest signing in with Google keeps what they made: Google is linked to the SAME user. If that Google account
 * already has its own account here (a returning person on a new browser), we sign in to it instead.
 */
export async function upgradeGuestWithGoogle(supabase: AuthClient, redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo, queryParams: { prompt: "select_account" } } });
  if (!error) return;
  const text = `${(error as { code?: string }).code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (text.includes("already") || text.includes("identity_already_exists")) return startGoogleSignIn(supabase, redirectTo);
  throw error;
}

/** Does this session already have a Google identity? */
export function hasGoogle(session: Session | null): boolean {
  return Boolean(session?.user?.identities?.some((i) => i.provider === "google"));
}

/**
 * Gets Google permission for something extra (saving to Drive). Someone who signed in with Google just asks again with the
 * extra scope. Someone who signed in by email links their Google account to the SAME user instead, so nothing is lost.
 */
export async function connectGoogle(supabase: AuthClient, session: Session | null, redirectTo: string, scopes: string): Promise<void> {
  if (hasGoogle(session)) return startGoogleSignIn(supabase, redirectTo, scopes);
  const { error } = await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo, scopes } });
  if (error) throw error;
}

export interface Profile {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  initial: string;
}

/** What to show for the signed-in person (Google gives a name and a picture; an email account has neither). */
export function profileOf(session: Session | null): Profile {
  const user = session?.user;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const name = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
  const avatar = typeof meta.avatar_url === "string" ? meta.avatar_url : typeof meta.picture === "string" ? meta.picture : null;
  const email = user?.email ?? null;
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase() || "?";
  return { name, email, avatarUrl: avatar && /^https:\/\//.test(avatar) ? avatar : null, initial };
}

/** A friendly message for the errors people can actually fix. */
export function signInErrorMessage(error: unknown): string {
  const text = String((error as { message?: string })?.message ?? error ?? "").toLowerCase();
  const code = String((error as { code?: string })?.code ?? "").toLowerCase();
  if (code === "over_email_send_rate_limit" || text.includes("rate limit")) return "Too many emails were requested. Please wait a minute and try again.";
  if (code === "provider_disabled" || text.includes("provider is not enabled") || text.includes("unsupported provider")) return "Google sign-in is not switched on for this app yet.";
  if (code === "validation_failed" || text.includes("invalid email") || text.includes("unable to validate email")) return "That email address does not look right.";
  if (code === "email_address_invalid") return "That email address cannot be used.";
  if (code === "anonymous_provider_disabled" || text.includes("anonymous sign-ins are disabled")) return "The free try-out is not switched on yet. Please sign in to continue.";
  if (code === "manual_linking_disabled" || text.includes("manual linking is disabled")) return "Linking your account is not switched on yet. Please sign in again.";
  if (code === "over_request_rate_limit" || code === "over_sms_send_rate_limit") return "Too many tries from your network. Please wait a few minutes and try again.";
  if (code === "signup_disabled" || text.includes("signups not allowed")) return "New accounts are switched off right now.";
  if (text.includes("failed to fetch") || text.includes("network")) return "Could not reach the sign-in service. Check your connection and try again.";
  return "Sign-in did not work. Please try again.";
}
