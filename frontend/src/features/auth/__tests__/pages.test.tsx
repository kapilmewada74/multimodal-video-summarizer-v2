// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.fn();
const push = vi.fn();
let search = "";
let pathname = "/library";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("../../../lib/useTheme", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));

const auth = {
  ready: true, configured: true, signedIn: false, signingOut: false, session: null, email: null, usesGoogle: false,
  profile: { name: null, email: null, avatarUrl: null, initial: "?" },
  signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(), signOut: vi.fn(),
};
vi.mock("../AuthProvider", () => ({ useAuth: () => auth }));

import { RequireAuth } from "../RequireAuth";
import LoginPage from "../../../app/login/page";
import AuthCallbackPage from "../../../app/auth/callback/page";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(auth, { ready: true, configured: true, signedIn: false, signingOut: false });
  auth.signInWithGoogle.mockReset().mockResolvedValue(undefined);
  auth.signInWithEmail.mockReset().mockResolvedValue(undefined);
  replace.mockReset(); push.mockReset();
  search = ""; pathname = "/library";
  window.history.replaceState({}, "", "/library");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const setValue = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("RequireAuth", () => {
  const mount = () => act(() => root.render(<RequireAuth><p>secret page</p></RequireAuth>));

  it("shows the page to a signed-in person", () => {
    auth.signedIn = true;
    mount();
    expect(container.textContent).toBe("secret page");
    expect(replace).not.toHaveBeenCalled();
  });

  it("never shows the page to a visitor, and sends them to sign in, then back to the same page", () => {
    window.history.replaceState({}, "", "/library?tab=2");
    mount();
    expect(container.textContent).not.toContain("secret page");
    expect(replace).toHaveBeenCalledWith("/login?next=%2Flibrary%3Ftab%3D2");
    expect(container.querySelector("[role=status]")).not.toBeNull();
  });

  it("does not bounce someone to the login page while they are signing out (they are on their way home)", () => {
    auth.signingOut = true;
    mount();
    expect(replace).not.toHaveBeenCalled();
  });

  it("waits while the saved session is being read, without redirecting early", () => {
    auth.ready = false;
    mount();
    expect(container.textContent).toContain("Loading");
    expect(container.textContent).not.toContain("secret page");
    expect(replace).not.toHaveBeenCalled();
  });

  it("explains it when sign-in is not set up, instead of redirecting forever", () => {
    auth.configured = false;
    mount();
    expect(container.querySelector("[role=alert]")!.textContent).toContain("not set up");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("login page", () => {
  const mount = async () => { await act(async () => root.render(<LoginPage />)); };
  const buttonText = (t: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(t)) as HTMLButtonElement;

  it("offers Google and an email link, and no guest option", async () => {
    await mount();
    expect(buttonText("Continue with Google")).toBeDefined();
    expect(buttonText("Email me a sign-in link")).toBeDefined();
    expect(container.textContent?.toLowerCase()).not.toContain("guest");
    expect(container.textContent?.toLowerCase()).not.toContain("anonymous");
  });

  it("Continue with Google goes to Google and remembers where the person was going", async () => {
    search = "next=%2Fvideo%2Fabc";
    await mount();
    await act(async () => { buttonText("Continue with Google").click(); });
    expect(auth.signInWithGoogle).toHaveBeenCalledWith("/video/abc");
  });

  it("a hostile next address is ignored", async () => {
    search = "next=https%3A%2F%2Fevil.example";
    await mount();
    await act(async () => { buttonText("Continue with Google").click(); });
    expect(auth.signInWithGoogle).toHaveBeenCalledWith("/library");
  });

  it("shows why Google failed and lets the person try again", async () => {
    auth.signInWithGoogle.mockRejectedValue(new Error("Google sign-in is not switched on for this app yet."));
    await mount();
    await act(async () => { buttonText("Continue with Google").click(); });
    expect(q("[role=alert]").textContent).toContain("not switched on");
    expect(buttonText("Continue with Google").disabled).toBe(false);
  });

  it("will not send a link to something that is not an email address", async () => {
    await mount();
    act(() => setValue(q<HTMLInputElement>("#login-email"), "not-an-email"));
    await act(async () => { q<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(auth.signInWithEmail).not.toHaveBeenCalled();
    expect(q("[role=alert]").textContent).toContain("valid email");
  });

  it("the email button stays off until something is typed", async () => {
    await mount();
    expect(buttonText("Email me a sign-in link").disabled).toBe(true);
    act(() => setValue(q<HTMLInputElement>("#login-email"), "a@b.co"));
    expect(buttonText("Email me a sign-in link").disabled).toBe(false);
  });

  it("sends the link, then says to check the inbox, with a resend that waits a minute", async () => {
    search = "next=%2Fstudy";
    await mount();
    act(() => setValue(q<HTMLInputElement>("#login-email"), "Ada@Example.com "));
    await act(async () => { q<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(auth.signInWithEmail).toHaveBeenCalledWith("Ada@Example.com", "/study");
    expect(container.textContent).toContain("Check your email");
    expect(container.textContent).toContain("ada@example.com");
    expect(buttonText("Send again in 60s").disabled).toBe(true);
    for (let i = 0; i < 60; i++) await act(async () => { vi.advanceTimersByTime(1000); });   // one second at a time: each tick schedules the next
    expect(buttonText("Send the link again").disabled).toBe(false);
    await act(async () => { buttonText("Send the link again").click(); });
    expect(auth.signInWithEmail).toHaveBeenCalledTimes(2);
  });

  it("shows the reason when the link cannot be sent (for example too many requests)", async () => {
    auth.signInWithEmail.mockRejectedValue(new Error("Too many emails were requested. Please wait a minute and try again."));
    await mount();
    act(() => setValue(q<HTMLInputElement>("#login-email"), "a@b.co"));
    await act(async () => { q<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(q("[role=alert]").textContent).toContain("Too many emails");
    expect(container.textContent).not.toContain("Check your email");
  });

  it("lets the person go back and use a different email", async () => {
    await mount();
    act(() => setValue(q<HTMLInputElement>("#login-email"), "a@b.co"));
    await act(async () => { q<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    act(() => buttonText("Use a different email").click());
    expect(q("#login-email")).not.toBeNull();
  });

  it("someone already signed in is sent straight on", async () => {
    auth.signedIn = true;
    search = "next=%2Fplaylists";
    await mount();
    expect(replace).toHaveBeenCalledWith("/playlists");
  });

  it("shows a message when Supabase sent the person back with an error", async () => {
    search = "error=access_denied";
    await mount();
    expect(q("[role=alert]").textContent).toContain("did not finish");
  });

  it("says plainly when sign-in is not set up", async () => {
    auth.configured = false;
    await mount();
    expect(container.textContent).toContain("not set up");
    expect(container.querySelector("#login-email")).toBeNull();
  });
});

describe("callback page", () => {
  const mount = async () => { await act(async () => root.render(<AuthCallbackPage />)); };

  it("waits for the session, then continues to where the person was going", async () => {
    search = "next=%2Fvideo%2F1";
    await mount();
    expect(container.textContent).toContain("Signing you in");
    expect(replace).not.toHaveBeenCalled();
    auth.signedIn = true;
    await mount();
    expect(replace).toHaveBeenCalledWith("/video/1");
  });

  it("goes to the library when there is no (or an unsafe) destination", async () => {
    auth.signedIn = true;
    search = "next=//evil.example";
    await mount();
    expect(replace).toHaveBeenCalledWith("/library");
  });

  it("explains an expired or used link, and offers to start again", async () => {
    search = "error_description=Email+link+is+invalid+or+has+expired&next=%2Fstudy";
    await mount();
    expect(q("[role=alert]").textContent).toContain("expired or was already used");
    expect(q<HTMLAnchorElement>("a").getAttribute("href")).toBe("/login?next=%2Fstudy");
  });

  it("gives up after a while instead of spinning forever", async () => {
    await mount();
    await act(async () => { vi.advanceTimersByTime(13_000); });
    expect(q("[role=alert]").textContent).toContain("could not sign you in");
  });
});
