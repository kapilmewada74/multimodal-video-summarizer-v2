// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = {
  videos: { used: 5, limit: 10, remaining: 5, resets_at: "2999-01-01T00:00:00Z" },
  generations: { used: 12, limit: 60, resets_at: "2999-01-01T00:00:00Z" },
  uploads: { max_bytes: 500 * 1024 * 1024, extensions: [".mp4", ".mp3"], max_video_seconds: 10800 },
  documents: { max_bytes: 25 * 1024 * 1024, max_count: 500, count: 3, extensions: [".pdf", ".txt"] },
  storage: { used_bytes: 512 * 1024 * 1024, quota_bytes: 2048 * 1024 * 1024 },
};
const apiFetch = vi.fn();
let auth: Record<string, unknown> = {};
vi.mock("../../../lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { AccountOverview } from "../AccountOverview";

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  apiFetch.mockReset().mockResolvedValue({ ok: true, json: async () => data });
  auth = { ready: true, signedIn: true, usesGoogle: true, profile: { name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null, initial: "A" } };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async () => {
  act(() => root.render(<AccountOverview />));
  await flush();
  await flush();
};

describe("About and Usage", () => {
  it("shows who is signed in and how", async () => {
    await render();
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("ada@example.com");
    expect(container.textContent).toContain("Signed in with Google");
  });

  it("shows today's usage as a count and a bar", async () => {
    await render();
    const text = container.textContent!;
    expect(text).toContain("5 of 10");
    expect(text).toContain("12 of 60");
    const bar = container.querySelector("[role='progressbar'][aria-label='Videos used today']")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(container.querySelector("[role='progressbar'][aria-label='AI generations used today']")!.getAttribute("aria-valuenow")).toBe("20");
  });

  it("lists the upload, video, document and storage limits in plain words", async () => {
    await render();
    const text = container.textContent!;
    expect(text).toContain("500 MB per file");
    expect(text).toContain("MP4 and MP3");
    expect(text).toContain("Up to 3 hours");
    expect(text).toContain("25 MB per file");
    expect(text).toContain("PDF and TXT");
    expect(text).toContain("3 of 500");
    expect(text).toContain("512 MB of 2 GB");
    expect(container.querySelector("[role='progressbar'][aria-label='Storage used']")!.getAttribute("aria-valuenow")).toBe("25");
  });

  it("asks for the figures from the account endpoint", async () => {
    await render();
    expect(apiFetch).toHaveBeenCalledWith("/api/me/limits");
  });

  it("says so, instead of showing nothing, when the figures cannot be loaded", async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500 });
    await render();
    expect(container.querySelector("[role='alert']")!.textContent).toContain("could not load");
  });

  it("does not ask for anything before sign-in is known", async () => {
    auth = { ...auth, ready: false };
    await render();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("links to privacy, terms and settings", async () => {
    await render();
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/privacy", "/terms", "/settings"]));
  });
});
