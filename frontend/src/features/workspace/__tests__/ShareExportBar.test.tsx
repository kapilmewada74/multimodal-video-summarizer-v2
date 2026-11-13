// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "k".repeat(40);
vi.mock("../../../lib/api", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ share: { active: true, token: TOKEN } }) })),
  readError: vi.fn(),
}));
vi.mock("../../../lib/supabase", () => ({ getSupabase: () => null }));

import { ShareExportBar } from "../ShareExportBar";

let container: HTMLDivElement;
let root: Root;
const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
});

const openPanel = async () => {
  act(() => root.render(<ShareExportBar videoId="v1" title="Feature Scaling" onToast={() => {}} />));
  await flush();
  act(() => (Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Shared")) as HTMLButtonElement).click());
};
const link = (label: string) => container.querySelector(`a[aria-label='${label}']`) as HTMLAnchorElement | null;

describe("sharing a summary", () => {
  it("offers the apps people actually use, each carrying the link", async () => {
    await openPanel();
    const url = `${window.location.origin}/s/${TOKEN}`;
    expect(decodeURIComponent(link("Share on WhatsApp")!.href)).toContain(url);
    expect(decodeURIComponent(link("Share on Telegram")!.href)).toContain(url);
    expect(decodeURIComponent(link("Share on X")!.href)).toContain(url);
    expect(decodeURIComponent(link("Share on LinkedIn")!.href)).toContain(url);
    expect(link("Share by email")!.href.startsWith("mailto:")).toBe(true);
  });

  it("sends the themed message with the title, not a bare link", async () => {
    await openPanel();
    const text = decodeURIComponent(link("Share on WhatsApp")!.href);
    expect(text).toContain("Feature Scaling");
    expect(text).toContain("SUMMARIZE.AI");
  });

  it("opens other sites safely", async () => {
    await openPanel();
    for (const label of ["Share on WhatsApp", "Share on Telegram", "Share on X", "Share on LinkedIn"]) {
      expect(link(label)!.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link(label)!.getAttribute("target")).toBe("_blank");
    }
  });

  it("shows the real card picture people will see", async () => {
    await openPanel();
    const preview = container.querySelector("img")!;
    expect(preview.getAttribute("src")).toBe(`${window.location.origin}/s/${TOKEN}/opengraph-image`);
    expect(container.textContent).toContain("How your link looks when shared");
  });

  it("offers the phone's share sheet only where the browser has one", async () => {
    await openPanel();
    expect(container.querySelector("button[aria-label='More ways to share']")).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    await openPanel();
    act(() => (container.querySelector("button[aria-label='More ways to share']") as HTMLButtonElement).click());
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}/s/${TOKEN}`, title: "Feature Scaling" }));
  });
});
