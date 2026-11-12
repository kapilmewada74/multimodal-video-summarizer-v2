import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { callbackUrl, connectGoogle, hasGoogle, isValidEmail, profileOf, safeNext, sendEmailLink, signInErrorMessage, startGoogleSignIn } from "../session";

const client = (over: Record<string, unknown> = {}) => ({
  auth: {
    signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    linkIdentity: vi.fn().mockResolvedValue({ error: null }),
    ...over,
  },
});
const session = (user: Record<string, unknown>): Session => ({ user } as unknown as Session);

describe("safeNext (where to go after signing in)", () => {
  it("accepts paths inside the site, with their query", () => {
    expect(safeNext("/library")).toBe("/library");
    expect(safeNext("/video/abc?t=5")).toBe("/video/abc?t=5");
    expect(safeNext("%2Fplaylists%2F1")).toBe("/playlists/1");
  });

  it("falls back to the library when there is nothing", () => {
    expect(safeNext(null)).toBe("/library");
    expect(safeNext("")).toBe("/library");
    expect(safeNext(undefined, "/")).toBe("/");
  });

  it("never sends anyone to another site", () => {
    for (const bad of ["https://evil.example", "http://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example", "\\\\evil.example", "%2F%2Fevil.example", "https%3A%2F%2Fevil.example"])
      expect(safeNext(bad), bad).toBe("/library");
  });

  it("refuses control characters and broken encoding", () => {
    expect(safeNext("/ok\r\nLocation: https://evil.example")).toBe("/library");
    expect(safeNext("/%E0%A4%A")).toBe("/library");
  });

  it("never loops back into the sign-in pages", () => {
    expect(safeNext("/login")).toBe("/library");
    expect(safeNext("/login?next=/x")).toBe("/library");
    expect(safeNext("/auth/callback?next=/x")).toBe("/library");
  });
});

describe("callbackUrl", () => {
  it("points back at our own callback with a safe, encoded next", () => {
    expect(callbackUrl("https://app.test", "/video/1?a=b")).toBe("https://app.test/auth/callback?next=%2Fvideo%2F1%3Fa%3Db");
    expect(callbackUrl("https://app.test", "https://evil.example")).toBe("https://app.test/auth/callback?next=%2Flibrary");
  });
});

describe("isValidEmail", () => {
  it("accepts normal addresses and rejects obvious mistakes", () => {
    for (const ok of ["a@b.co", "first.last+tag@sub.example.com", " me@example.org "]) expect(isValidEmail(ok), ok).toBe(true);
    for (const bad of ["", "plain", "a@b", "a@b.", "@b.com", "a b@c.com", "a@@b.com", `${"x".repeat(250)}@b.com`]) expect(isValidEmail(bad), bad).toBe(false);
  });
});

describe("startGoogleSignIn", () => {
  it("asks Google (letting the person choose the account) and comes back to our callback", async () => {
    const c = client();
    await startGoogleSignIn(c as never, "https://app.test/auth/callback?next=%2F");
    expect(c.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://app.test/auth/callback?next=%2F", queryParams: { prompt: "select_account" } },
    });
  });

  it("can ask for extra permission, and reports failures", async () => {
    const c = client();
    await startGoogleSignIn(c as never, "https://x/cb", "https://www.googleapis.com/auth/drive.file");
    expect(c.auth.signInWithOAuth.mock.calls[0][0].options.scopes).toBe("https://www.googleapis.com/auth/drive.file");
    const failing = client({ signInWithOAuth: vi.fn().mockResolvedValue({ error: new Error("boom") }) });
    await expect(startGoogleSignIn(failing as never, "https://x/cb")).rejects.toThrow("boom");
  });
});

describe("sendEmailLink", () => {
  it("sends a one-time link to the lower-cased, trimmed address and allows first-time sign-up", async () => {
    const c = client();
    await sendEmailLink(c as never, "  Me@Example.COM ", "https://app.test/auth/callback");
    expect(c.auth.signInWithOtp).toHaveBeenCalledWith({ email: "me@example.com", options: { emailRedirectTo: "https://app.test/auth/callback", shouldCreateUser: true } });
  });

  it("throws what Supabase said", async () => {
    const c = client({ signInWithOtp: vi.fn().mockResolvedValue({ error: { code: "over_email_send_rate_limit", message: "x" } }) });
    await expect(sendEmailLink(c as never, "a@b.co", "https://x")).rejects.toMatchObject({ code: "over_email_send_rate_limit" });
  });
});

describe("connectGoogle (for Drive)", () => {
  const scopes = "https://www.googleapis.com/auth/drive.file";
  it("someone who signed in with Google just asks again with the extra permission", async () => {
    const c = client();
    await connectGoogle(c as never, session({ identities: [{ provider: "google" }] }), "https://x/cb", scopes);
    expect(c.auth.signInWithOAuth).toHaveBeenCalledOnce();
    expect(c.auth.linkIdentity).not.toHaveBeenCalled();
  });

  it("someone who signed in by email links Google to the same account instead of making a second one", async () => {
    const c = client();
    await connectGoogle(c as never, session({ identities: [{ provider: "email" }] }), "https://x/cb", scopes);
    expect(c.auth.linkIdentity).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://x/cb", scopes } });
    expect(c.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("reports a failed link", async () => {
    const c = client({ linkIdentity: vi.fn().mockResolvedValue({ error: new Error("nope") }) });
    await expect(connectGoogle(c as never, session({ identities: [] }), "https://x/cb", scopes)).rejects.toThrow("nope");
  });

  it("knows whether a session has Google", () => {
    expect(hasGoogle(session({ identities: [{ provider: "google" }] }))).toBe(true);
    expect(hasGoogle(session({ identities: [{ provider: "email" }] }))).toBe(false);
    expect(hasGoogle(session({}))).toBe(false);
    expect(hasGoogle(null)).toBe(false);
  });
});

describe("profileOf", () => {
  it("uses the Google name and picture", () => {
    const p = profileOf(session({ email: "r@x.com", user_metadata: { full_name: "Rahul D", avatar_url: "https://lh3.googleusercontent.com/a" } }));
    expect(p).toEqual({ name: "Rahul D", email: "r@x.com", avatarUrl: "https://lh3.googleusercontent.com/a", initial: "R" });
  });

  it("falls back to the email initial for an email account", () => {
    expect(profileOf(session({ email: "zed@x.com" }))).toEqual({ name: null, email: "zed@x.com", avatarUrl: null, initial: "Z" });
  });

  it("only trusts https pictures, and copes with nothing", () => {
    expect(profileOf(session({ email: "a@b.c", user_metadata: { picture: "http://insecure/x.png" } })).avatarUrl).toBeNull();
    expect(profileOf(session({ email: "a@b.c", user_metadata: { picture: "javascript:alert(1)" } })).avatarUrl).toBeNull();
    expect(profileOf(null)).toEqual({ name: null, email: null, avatarUrl: null, initial: "?" });
  });
});

describe("signInErrorMessage", () => {
  it("explains the problems a person can fix", () => {
    expect(signInErrorMessage({ code: "over_email_send_rate_limit" })).toContain("wait a minute");
    expect(signInErrorMessage({ message: "Unsupported provider: provider is not enabled" })).toContain("not switched on");
    expect(signInErrorMessage({ code: "validation_failed" })).toContain("does not look right");
    expect(signInErrorMessage(new Error("Failed to fetch"))).toContain("Could not reach");
    expect(signInErrorMessage({ code: "signup_disabled" })).toContain("switched off");
  });

  it("never shows raw technical text", () => {
    const text = signInErrorMessage(new Error("AuthApiError: weird internal 500 stack"));
    expect(text).toBe("Sign-in did not work. Please try again.");
  });
});
