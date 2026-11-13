// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MindMapData } from "../../../lib/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The drawing itself is tested elsewhere; here only the buttons matter. It reports how many branches are folded.
vi.mock("../MindMapCanvas", () => ({
  MindMapCanvas: ({ collapsed }: { collapsed: Set<string> }) => <div data-testid="canvas" data-folded={collapsed.size} />,
}));

import { MindMapView } from "../MindMapView";

const data: MindMapData = {
  title: "Root",
  children: [
    { title: "A", children: [{ title: "A1", children: [{ title: "A1a", children: [] }] }] },
    { title: "B", children: [{ title: "B1", children: [{ title: "B1a", children: [] }] }] },
  ],
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const show = (onGenerate?: () => void) => act(() => root.render(<MindMapView data={data} onGenerate={onGenerate} />));
const button = (label: string) => container.querySelector(`button[aria-label='${label}']`) as HTMLButtonElement | null;
const folded = () => Number(container.querySelector("[data-testid='canvas']")!.getAttribute("data-folded"));
const toolbar = () => container.querySelector("[role='toolbar'][aria-label='Mind map actions']")!;

describe("mind map actions", () => {
  it("shows four small icon buttons instead of six labelled ones", () => {
    show(() => undefined);
    const labels = Array.from(toolbar().querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Expand all", "Download image", "Copy outline", "Regenerate"]);
    for (const b of Array.from(toolbar().querySelectorAll("button"))) expect(b.textContent?.trim()).toBe("");   // icons only
  });

  it("has no Regenerate on a read-only (shared) map", () => {
    show();
    expect(button("Regenerate")).toBeNull();
  });

  it("one button expands, then offers to collapse, and back", () => {
    show();
    expect(folded()).toBeGreaterThan(0);                       // starts partly folded
    expect(button("Collapse all")).toBeNull();
    act(() => button("Expand all")!.click());
    expect(folded()).toBe(0);
    expect(button("Expand all")).toBeNull();
    act(() => button("Collapse all")!.click());
    expect(folded()).toBeGreaterThan(0);
    expect(button("Expand all")).not.toBeNull();
  });

  it("puts PNG and SVG behind one download button", () => {
    show();
    expect(container.textContent).not.toContain("PNG");
    act(() => button("Download image")!.click());
    const items = Array.from(document.querySelectorAll("[role='menuitem']")).map((i) => i.textContent);
    expect(items.some((t) => t?.includes("PNG"))).toBe(true);
    expect(items.some((t) => t?.includes("SVG"))).toBe(true);
  });

  it("offers no image download in the outline view", () => {
    localStorage.setItem("mindmap-view-v1", "outline");
    show();
    expect(button("Download image")).toBeNull();
    expect(button("Copy outline")).not.toBeNull();
  });

  it("copies the outline and says so", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    const toast = vi.fn();
    act(() => root.render(<MindMapView data={data} onToast={toast} />));
    await act(async () => button("Copy outline")!.click());
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain("Root");
    expect(toast).toHaveBeenCalledWith("Mind map copied as an outline.", "success");
  });

  it("regenerates, and shows it is busy", () => {
    const onGenerate = vi.fn();
    act(() => root.render(<MindMapView data={data} onGenerate={onGenerate} />));
    act(() => button("Regenerate")!.click());
    expect(onGenerate).toHaveBeenCalledWith(true);
    act(() => root.render(<MindMapView data={data} onGenerate={onGenerate} isLoading />));
    expect(button("Regenerate")!.disabled).toBe(true);
    expect(button("Regenerate")!.querySelector("svg")!.getAttribute("class")).toContain("animate-spin");
  });
});
