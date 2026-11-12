// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signedInAuth = {
  configured: true, signedIn: true, signingOut: false, ready: true, email: "ada@example.com", usesGoogle: true, session: null,
  profile: { name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null, initial: "A" },
  signInWithGoogle: vi.fn(), signInWithEmail: vi.fn(), signOut: vi.fn(),
};
const signedOutAuth = { ...signedInAuth, signedIn: false, email: null as string | null, usesGoogle: false, profile: { name: null as string | null, email: null as string | null, avatarUrl: null as string | null, initial: "?" } };
let auth: typeof signedInAuth | typeof signedOutAuth = signedInAuth;
vi.mock("../../features/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../features/notifications/NotificationBell", () => ({ NotificationBell: () => <button aria-label="Notifications" /> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { Navbar } from "../Navbar";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  auth = signedInAuth;
  signedInAuth.signOut.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = "";
});

const open = () => {
  act(() => root.render(<Navbar theme="light" onToggleTheme={() => {}} />));
  act(() => (container.querySelector("[aria-label='Open navigation menu']") as HTMLButtonElement).click());
};

describe("mobile navigation", () => {
  it("renders the menu OUTSIDE the nav bar (the bar's backdrop blur would otherwise shrink a fixed menu to the bar's height)", () => {
    open();
    const menu = container.querySelector("#mobile-nav-menu");
    expect(menu).not.toBeNull();
    expect(menu!.closest("nav")).toBeNull();
    expect(container.querySelector("nav")).not.toBeNull();
  });

  it("shows who is signed in, with a sign-out button and the theme switch, in the phone menu", () => {
    open();
    const menu = container.querySelector("#mobile-nav-menu")!;
    expect(menu.textContent).toContain("Ada Lovelace");
    expect(menu.textContent).toContain("ada@example.com");
    expect(menu.querySelector("[aria-label='Sign out']")).not.toBeNull();
    act(() => (menu.querySelector("[aria-label='Sign out']") as HTMLButtonElement).click());
    expect(signedInAuth.signOut).toHaveBeenCalledTimes(1);
    expect(menu.textContent).toContain("Switch to dark mode");
    const bar = container.querySelector("nav")!;
    // On small screens these are hidden in the bar (sm: and up shows them there).
    expect(bar.querySelector("[aria-label='Toggle theme']")!.className).toContain("hidden sm:flex");
  });

  it("offers every page in the menu, keeps the page from scrolling behind it, and can scroll when the screen is short", () => {
    open();
    const menu = container.querySelector("#mobile-nav-menu") as HTMLElement;
    for (const label of ["Your Library", "Playlists", "Study & Goals", "Notification Settings"]) expect(menu.textContent).toContain(label);
    expect(menu.className).toContain("overflow-y-auto");
    expect(document.body.style.overflow).toBe("hidden");
    act(() => (container.querySelector("[aria-label='Close navigation menu']") as HTMLButtonElement).click());
    expect(container.querySelector("#mobile-nav-menu")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape", () => {
    open();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector("#mobile-nav-menu")).toBeNull();
  });
});

describe("signed-out visitors", () => {
  it("see a Sign in link (to the login page) in the bar and in the phone menu, and no account pages", () => {
    auth = signedOutAuth;
    open();
    const links = [...container.querySelectorAll("a")].filter((a) => a.textContent?.includes("Sign in"));
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.every((a) => a.getAttribute("href") === "/login")).toBe(true);
    expect(container.textContent).not.toContain("Your Library");
    expect(container.textContent).not.toContain("guest");
  });

  it("never offer a guest account", () => {
    auth = signedOutAuth;
    open();
    expect(container.textContent?.toLowerCase()).not.toContain("guest");
  });
});

describe("navigation bar", () => {
  it("is fixed to the top of the screen (not sticky, which an overflow rule on any ancestor can break), with a spacer under it", () => {
    act(() => root.render(<Navbar theme="light" onToggleTheme={() => {}} />));
    const bar = container.querySelector("nav")!;
    expect(bar.className).toContain("fixed");
    expect(bar.className).toContain("top-0");
    expect(bar.className).not.toContain("sticky");
    expect(bar.previousElementSibling?.className).toContain("h-16"); // keeps the page from sliding under the bar
  });

  it("has no separate Documents section: files live beside the videos in the playlists", () => {
    act(() => root.render(<Navbar theme="light" onToggleTheme={() => {}} />));
    act(() => (container.querySelector("[aria-label='Open navigation menu']") as HTMLButtonElement).click());
    expect(container.textContent).not.toContain("Documents");
  });
});

describe("phone safety rules in the global stylesheet", () => {
  const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

  it("lets plain grids shrink, so one long title cannot push a list off the screen", () => {
    expect(css).toMatch(/\.grid:not\(\[class\^="grid-cols-"\]\)[^{]*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  });

  it("never lets the page scroll sideways, without breaking sticky elements", () => {
    expect(css).toMatch(/body\s*\{\s*overflow-x: clip;/);
  });

  it("keeps iOS from zooming into small form fields", () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*font-size: 16px/);
  });
});
