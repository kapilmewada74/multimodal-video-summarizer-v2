// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  configured: true, signingOut: false, ready: true, email: null as string | null, usesGoogle: false, session: null,
  profile: { name: null as string | null, email: null as string | null, avatarUrl: null as string | null, initial: "?" },
  signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(), signOut: vi.fn(),
};
let auth = { ...base, signedIn: false };
let pathname = "/";
vi.mock("../../features/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => pathname }));
vi.mock("../../features/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { Navbar, isActivePath } from "../Navbar";

let container: HTMLDivElement;
let root: Root;
const render = () => act(() => root.render(<Navbar theme="light" onToggleTheme={() => {}} />));
const logo = () => container.querySelector("a[aria-label='SUMMARIZE.AI home']") as HTMLAnchorElement;
const bar = () => container.querySelector("nav")!;

beforeEach(() => {
  auth = { ...base, signedIn: false };
  pathname = "/";
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("navbar", () => {
  it("the logo and name are a real link to the home page", () => {
    pathname = "/library";
    render();
    expect(logo().getAttribute("href")).toBe("/");
    expect(logo().textContent).toContain("SUMMARIZE");
  });

  it("on the home page the logo scrolls to the top instead of reloading", () => {
    pathname = "/";
    render();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void logo().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(window.scrollTo).toHaveBeenCalled();
  });

  it("on any other page the logo is left to navigate home", () => {
    pathname = "/summary/abc";
    render();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => void logo().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("has a Home link everywhere, marked as current only on the home page", () => {
    render();
    const home = Array.from(bar().querySelectorAll("a")).find((a) => a.textContent === "Home")!;
    expect(home.getAttribute("href")).toBe("/");
    expect(home.getAttribute("aria-current")).toBe("page");
    pathname = "/privacy";
    render();
    expect(Array.from(bar().querySelectorAll("a")).find((a) => a.textContent === "Home")!.getAttribute("aria-current")).toBeNull();
  });

  it("has no Features, How It Works or FAQ links, on the bar or in the phone menu", () => {
    render();
    expect(bar().textContent).not.toMatch(/Features|How It Works|FAQ/);
    act(() => (container.querySelector("[aria-label='Open navigation menu']") as HTMLButtonElement).click());
    expect(container.querySelector("#mobile-nav-menu")!.textContent).not.toMatch(/Features|How It Works|Frequently Asked/);
  });

  it("visitors and guests do not see account pages; they are offered Sign in", () => {
    render();
    const text = bar().textContent!;
    expect(text).not.toContain("Library");
    expect(text).not.toContain("Playlists");
    expect(text).toContain("Sign in");
  });

  it("signed-in people get their pages, and the current one is marked", () => {
    auth = { ...base, signedIn: true };
    pathname = "/library";
    render();
    const link = Array.from(bar().querySelectorAll("a")).find((a) => a.textContent === "Library")!;
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(bar().textContent).toContain("Playlists");
    expect(bar().textContent).toContain("Study");
  });

  it("the phone menu has Home and its main button goes home", () => {
    pathname = "/summary/abc";
    render();
    act(() => (container.querySelector("[aria-label='Open navigation menu']") as HTMLButtonElement).click());
    const menu = container.querySelector("#mobile-nav-menu")!;
    const links = Array.from(menu.querySelectorAll("a"));
    expect(links.some((a) => a.textContent?.includes("Home") && a.getAttribute("href") === "/")).toBe(true);
    expect(links.map((a) => a.getAttribute("href"))).not.toContain("/#features");
    const cta = links.find((a) => a.textContent?.includes("Summarize New Video"))!;
    expect(cta.getAttribute("href")).toBe("/");
  });
});

describe("the underline under the current page", () => {
  const underlined = () => Array.from(bar().querySelectorAll("a")).filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent);

  it.each([
    ["/", "Home"],
    ["/summary/abc", "Home"],
    ["/library", "Library"],
    ["/video/abc", "Library"],
    ["/playlists", "Playlists"],
    ["/playlists/42", "Playlists"],
    ["/study", "Study"],
  ])("%s marks %s, and only that one", (path, name) => {
    auth = { ...base, signedIn: true };
    pathname = path;
    render();
    expect(underlined()).toEqual([name]);
    const mark = Array.from(bar().querySelectorAll("a")).find((a) => a.textContent === name)!;
    expect(mark.className).toContain("border-[var(--brand-lime)]");
  });

  it("pages that are not on the bar mark nothing, and never the wrong link", () => {
    auth = { ...base, signedIn: true };
    for (const path of ["/settings", "/documents", "/privacy", "/librarian"]) {
      pathname = path;
      render();
      expect(underlined(), path).toEqual([]);
    }
  });

  it("other links get no underline, not even on hover", () => {
    auth = { ...base, signedIn: true };
    pathname = "/library";
    render();
    const other = Array.from(bar().querySelectorAll("a")).find((a) => a.textContent === "Study")!;
    expect(other.className).toContain("border-transparent");
    expect(other.className).not.toContain("hover:border");
  });

  it("matches whole path segments only", () => {
    expect(isActivePath("/librarian", "/library")).toBe(false);
    expect(isActivePath("/library/x", "/library")).toBe(true);
    expect(isActivePath("/summaryx", "/")).toBe(false);
  });
});
