// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signInWithGoogle = vi.fn();
let auth: Record<string, unknown> = {};
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ usePathname: () => "/summary/abc" }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { SignInCard, SignInNudge } from "../SignInCard";
import { NUDGE_KEY, SESSION_KEY, resetNudgeSessionForTests } from "../nudge";

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  resetNudgeSessionForTests();
  signInWithGoogle.mockReset().mockResolvedValue(undefined);
  auth = { ready: true, configured: true, signedIn: false, signInWithGoogle };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const dialog = () => document.querySelector("[role='dialog']");

describe("the sign-in card", () => {
  it("offers Google, an email option and a way out", () => {
    act(() => root.render(<SignInCard onClose={() => {}} />));
    expect(dialog()!.textContent).toContain("Continue with Google");
    expect(dialog()!.querySelector("a")!.getAttribute("href")).toBe("/login?next=%2Fsummary%2Fabc");
    expect(dialog()!.textContent).toContain("Maybe later");
  });

  it("does not block the page: it is not modal", () => {
    act(() => root.render(<SignInCard onClose={() => {}} />));
    expect(dialog()!.getAttribute("aria-modal")).toBe("false");
  });

  it("signing in comes back to the page the person was on (or the one given)", async () => {
    act(() => root.render(<SignInCard onClose={() => {}} next="/video/xyz" />));
    const button = Array.from(dialog()!.querySelectorAll("button")).find((b) => b.textContent?.includes("Continue with Google"))!;
    act(() => button.click());
    await flush();
    expect(signInWithGoogle).toHaveBeenCalledWith("/video/xyz");
  });

  it("shows a readable message when sign-in fails and lets them try again", async () => {
    signInWithGoogle.mockRejectedValue(new Error("Google sign-in is not switched on for this app yet."));
    act(() => root.render(<SignInCard onClose={() => {}} />));
    act(() => (Array.from(dialog()!.querySelectorAll("button")).find((b) => b.textContent?.includes("Continue with Google")) as HTMLButtonElement).click());
    await flush();
    expect(dialog()!.querySelector("[role='alert']")!.textContent).toContain("not switched on");
    expect((Array.from(dialog()!.querySelectorAll("button")).find((b) => b.textContent?.includes("Continue with Google")) as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    act(() => root.render(<SignInCard onClose={onClose} />));
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the gentle reminder", () => {
  it("appears after the delay, not before", () => {
    act(() => root.render(<SignInNudge delayMs={30_000} />));
    expect(dialog()).toBeNull();
    act(() => void vi.advanceTimersByTime(29_999));
    expect(dialog()).toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(dialog()).not.toBeNull();
  });

  const dismiss = () => act(() => (Array.from(dialog()!.querySelectorAll("button")).find((b) => b.textContent === "Maybe later") as HTMLButtonElement).click());
  /** A page showing the reminder. `newVisit` is a new browser session (tab closed and opened again). */
  const visit = (key: string, newVisit = true) => {
    if (newVisit) {
      sessionStorage.clear();
      resetNudgeSessionForTests();
    }
    act(() => root.render(<SignInNudge key={key} delayMs={1000} />));
    act(() => void vi.advanceTimersByTime(1000));
  };

  it("after the first dismissal it returns on the next visit, then rests for a week after the second", () => {
    visit("one");
    expect(dialog()).not.toBeNull();
    dismiss();
    expect(dialog()).toBeNull();
    expect(JSON.parse(localStorage.getItem(NUDGE_KEY)!).dismissals).toBe(1);

    visit("two");                       // next visit, same day: shown again
    expect(dialog()).not.toBeNull();
    dismiss();
    expect(JSON.parse(localStorage.getItem(NUDGE_KEY)!).dismissals).toBe(2);

    visit("three");                     // dismissed twice: stays away
    expect(dialog()).toBeNull();
  });

  it("once dismissed, it does not come back on other pages during the same visit", () => {
    visit("home");
    expect(dialog()).not.toBeNull();
    dismiss();
    for (const page of ["summary", "login", "library", "summary-again"]) {
      visit(page, false);               // moving to other pages: each mounts its own copy
      expect(dialog(), page).toBeNull();
    }
  });

  it("is shown once per visit even if it was never dismissed", () => {
    visit("home");
    expect(dialog()).not.toBeNull();
    visit("summary", false);            // left the page without closing it
    expect(dialog()).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBe("1");
  });

  it("closing it with the cross or Escape counts as dismissing it too", () => {
    visit("home");
    act(() => (dialog()!.querySelector("button[aria-label='Close']") as HTMLButtonElement).click());
    expect(JSON.parse(localStorage.getItem(NUDGE_KEY)!).dismissals).toBe(1);
    visit("summary", false);
    expect(dialog()).toBeNull();
    visit("next-visit");
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(JSON.parse(localStorage.getItem(NUDGE_KEY)!).dismissals).toBe(2);
  });

  it("closing a card the person opened themselves also stops the reminder for this visit", () => {
    act(() => root.render(<SignInCard title="Unlock the full workspace" onClose={() => {}} />));
    act(() => (dialog()!.querySelector("button[aria-label='Close']") as HTMLButtonElement).click());
    act(() => root.render(<SignInNudge key="after" delayMs={1000} />));
    act(() => void vi.advanceTimersByTime(5000));
    expect(dialog()).toBeNull();
  });

  it("never shows to someone who is signed in", () => {
    auth = { ...auth, signedIn: true };
    act(() => root.render(<SignInNudge delayMs={1000} />));
    act(() => void vi.advanceTimersByTime(5000));
    expect(dialog()).toBeNull();
  });

  it("never shows when sign-in is not set up", () => {
    auth = { ...auth, configured: false };
    act(() => root.render(<SignInNudge delayMs={1000} />));
    act(() => void vi.advanceTimersByTime(5000));
    expect(dialog()).toBeNull();
  });
});
