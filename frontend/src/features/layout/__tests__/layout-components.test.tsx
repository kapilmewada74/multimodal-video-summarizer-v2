// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPane } from "../../workspace/VideoPane";
import { ResizableSplit } from "../ResizableSplit";
import { WorkspaceLayout } from "../WorkspaceLayout";
import type { Collapsed, Orientation } from "../split";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let size = { width: 1400, height: 800 };

beforeEach(() => {
  size = { width: 1400, height: 800 };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => size.width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => size.height });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

const render = (node: React.ReactNode) => act(async () => { root.render(node); });
const separator = () => container.querySelector('[role="separator"]') as HTMLElement | null;
const pane = (which: "first" | "second") => container.querySelector(`[data-pane="${which}"]`) as HTMLElement | null;
/** One of the Split / Video / Notes switch buttons, found by its exact label. */
const view = (label: string) =>
  Array.from(container.querySelectorAll("[aria-label='Workspace view'] button")).find((b) => b.textContent === label) as HTMLButtonElement;
const resetButton = () => container.querySelector("button[aria-label='Reset layout']") as HTMLButtonElement;
const button = (name: RegExp) => Array.from(container.querySelectorAll("button")).find((b) => name.test(b.textContent ?? "") || name.test(b.getAttribute("title") ?? "")) as HTMLButtonElement;

function Harness(props: { orientation?: Orientation; collapsed?: Collapsed; start?: number; onReset?: () => void; onChange?: (f: number) => void }) {
  const [fraction, setFraction] = useState(props.start ?? 0.5);
  return (
    <div style={{ height: 400, width: 1000 }}>
      <ResizableSplit
        orientation={props.orientation ?? "row"} fraction={fraction} collapsed={props.collapsed ?? null}
        onFractionChange={(f) => { setFraction(f); props.onChange?.(f); }} onReset={props.onReset ?? (() => setFraction(0.5))}
        first={<div>video</div>} second={<div>notes</div>} firstLabel="Video" secondLabel="Notes"
      />
    </div>
  );
}

function pointer(type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
  return event;
}

describe("ResizableSplit", () => {
  it("shows two independently scrolling panes and an accessible divider", async () => {
    await render(<Harness />);
    expect(pane("first")?.textContent).toBe("video");
    expect(pane("second")?.textContent).toBe("notes");
    expect(pane("first")?.className).toContain("overflow-auto");
    expect(pane("second")?.className).toContain("overflow-auto");
    const sep = separator()!;
    expect(sep.getAttribute("aria-orientation")).toBe("vertical");
    expect(sep.getAttribute("aria-valuenow")).toBe("50");
    expect(sep.getAttribute("tabindex")).toBe("0");
    expect(sep.getAttribute("aria-label")).toContain("Video");
  });

  it("stacks vertically with a horizontal divider", async () => {
    await render(<Harness orientation="column" />);
    expect(separator()?.getAttribute("aria-orientation")).toBe("horizontal");
    expect(container.querySelector("[data-orientation]")?.className).toContain("flex-col");
  });

  it("splits the space by the given share", async () => {
    await render(<Harness start={0.3} />);
    expect(pane("first")?.style.flex).toBe("0 0 calc(30% - 6px)");
    expect(pane("second")?.style.flex).toBe("0 0 calc(70% - 6px)");
  });

  it("moves with the arrow keys, Home and End", async () => {
    const seen: number[] = [];
    await render(<Harness start={0.5} onChange={(f) => seen.push(f)} />);
    const press = (key: string) => act(async () => { separator()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    await press("ArrowRight");
    await press("ArrowRight");
    await press("ArrowLeft");
    expect(seen.map((f) => Math.round(f * 100))).toEqual([52, 54, 52]);
    await press("Home");
    await press("End");
    expect(Math.round(seen.at(-2)! * 100)).toBe(15);
    expect(Math.round(seen.at(-1)! * 100)).toBe(85);
    const before = seen.length;
    await press("ArrowUp"); // wrong direction for a side-by-side split
    await press("x");
    expect(seen.length).toBe(before);
  });

  it("is dragged with the pointer and never leaves the allowed range", async () => {
    const seen: number[] = [];
    await render(<Harness start={0.5} onChange={(f) => seen.push(f)} />);
    const box = container.querySelector("[data-orientation]") as HTMLElement;
    box.getBoundingClientRect = () => ({ left: 100, top: 0, width: 1000, height: 400, right: 1100, bottom: 400, x: 100, y: 0, toJSON: () => ({}) });
    const sep = separator()!;
    await act(async () => { sep.dispatchEvent(pointer("pointerdown", 600, 10)); });
    expect(pane("first")?.className).toContain("pointer-events-none"); // an iframe cannot steal the drag
    await act(async () => { sep.dispatchEvent(pointer("pointermove", 400, 10)); });
    await act(async () => { sep.dispatchEvent(pointer("pointermove", 9999, 10)); });
    await act(async () => { sep.dispatchEvent(pointer("pointermove", -9999, 10)); });
    expect(seen[0]).toBeCloseTo(0.3);
    expect(seen[1]).toBeCloseTo(0.84);
    expect(seen[2]).toBeCloseTo(0.16);
    await act(async () => { sep.dispatchEvent(pointer("pointerup", 400, 10)); });
    expect(pane("first")?.className).not.toContain("pointer-events-none");
    const count = seen.length;
    await act(async () => { sep.dispatchEvent(pointer("pointermove", 500, 10)); });
    expect(seen.length).toBe(count); // moving without pressing does nothing
  });

  it("uses the vertical position when stacked", async () => {
    const seen: number[] = [];
    await render(<Harness orientation="column" onChange={(f) => seen.push(f)} />);
    const box = container.querySelector("[data-orientation]") as HTMLElement;
    box.getBoundingClientRect = () => ({ left: 0, top: 50, width: 1000, height: 400, right: 1000, bottom: 450, x: 0, y: 50, toJSON: () => ({}) });
    const sep = separator()!;
    await act(async () => { sep.dispatchEvent(pointer("pointerdown", 5, 250)); });
    await act(async () => { sep.dispatchEvent(pointer("pointermove", 5, 250)); });
    expect(seen[0]).toBeCloseTo(0.5);
  });

  it("goes back to the default on double click", async () => {
    const reset = vi.fn();
    await render(<Harness onReset={reset} />);
    await act(async () => { separator()!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(reset).toHaveBeenCalledOnce();
  });

  it("hides a collapsed pane and the divider, and gives the other pane all the space", async () => {
    await render(<Harness collapsed="second" />);
    expect(pane("second")).toBeNull();
    expect(separator()).toBeNull();
    expect(pane("first")?.className).toContain("flex-1");
    await render(<Harness collapsed="first" />);
    expect(pane("first")).toBeNull();
    expect(pane("second")?.textContent).toBe("notes");
  });
});

describe("WorkspaceLayout", () => {
  const layout = () => <WorkspaceLayout video={<div>the video</div>} panel={<div>the notes</div>} storageKey="test-layout" />;

  it("starts side by side on a wide screen with both panes", async () => {
    await render(layout());
    expect(container.textContent).toContain("the video");
    expect(container.textContent).toContain("the notes");
    expect(separator()?.getAttribute("aria-orientation")).toBe("vertical");
    expect(view("Split").getAttribute("aria-pressed")).toBe("true");
  });

  it("has no Stacked option: it is one switch with Split, Video and Notes", async () => {
    await render(layout());
    expect(container.textContent).not.toMatch(/Stacked/);
    expect(container.textContent).not.toMatch(/Side by side/);
    const group = container.querySelector("[role='group'][aria-label='Workspace view']")!;
    expect(Array.from(group.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Split", "Video", "Notes"]);
  });

  it("stacks by itself on a narrow screen (tablet)", async () => {
    size = { width: 700, height: 900 };
    await render(layout());
    expect(separator()?.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("shows only the video, only the notes, or both again", async () => {
    await render(layout());
    await act(async () => { view("Video").click(); });
    expect(container.textContent).toContain("the video");
    expect(container.textContent).not.toContain("the notes");
    expect(view("Video").getAttribute("aria-pressed")).toBe("true");
    await act(async () => { view("Notes").click(); });
    expect(container.textContent).not.toContain("the video");
    expect(container.textContent).toContain("the notes");
    await act(async () => { view("Split").click(); });
    expect(container.textContent).toContain("the video");
    expect(container.textContent).toContain("the notes");
    expect(view("Split").getAttribute("aria-pressed")).toBe("true");
  });

  it("resets to the default layout", async () => {
    await render(layout());
    expect(resetButton().disabled).toBe(true);           // already the default
    await act(async () => { view("Video").click(); });
    await act(async () => { view("Split").click(); });
    await act(async () => { separator()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(resetButton().disabled).toBe(false);
    await act(async () => { resetButton().click(); });
    expect(separator()?.getAttribute("aria-valuenow")).toBe("42");
    expect(resetButton().disabled).toBe(true);
  });

  it("remembers the view between visits", async () => {
    await render(layout());
    await act(async () => { view("Video").click(); });
    expect(JSON.parse(localStorage.getItem("test-layout")!)).toMatchObject({ collapsed: "second" });
    act(() => root.unmount());
    root = createRoot(container);
    await render(layout());
    expect(container.textContent).not.toContain("the notes");
    expect(view("Video").getAttribute("aria-pressed")).toBe("true");
  });

  it("a layout saved with the old Stacked button is shown side by side again", async () => {
    localStorage.setItem("test-layout", JSON.stringify({ orientation: "column", fraction: 0.42, collapsed: null }));
    await render(layout());
    expect(separator()?.getAttribute("aria-orientation")).toBe("vertical");
    expect(resetButton().disabled).toBe(true);
  });

  it("ignores a damaged saved layout", async () => {
    localStorage.setItem("test-layout", '{"orientation":"sideways","fraction":"lots"}');
    await render(layout());
    expect(container.textContent).toContain("the video");
    expect(separator()?.getAttribute("aria-valuenow")).toBe("42");
  });

  it("gives the workspace a height of its own so each pane can scroll", async () => {
    await render(layout());
    const holder = container.querySelector('[data-orientation]')!.parentElement as HTMLElement;
    expect(holder.style.height).toContain("100dvh");
  });
});

describe("VideoPane keeps the video 16:9", () => {
  const playerBox = () => container.querySelector('[data-testid="player-box"]') as HTMLElement;

  it("fills a wide, tall pane by width", async () => {
    size = { width: 816, height: 900 };
    await render(<VideoPane player={<div>p</div>} />);
    expect(playerBox().style.width).toBe("800px");        // 816 - 16 padding; height would be 450
  });

  it("shrinks to fit a short pane instead of stretching or cropping", async () => {
    size = { width: 1200, height: 324 };
    await render(<VideoPane player={<div>p</div>} />);
    const width = parseInt(playerBox().style.width, 10);
    expect(width).toBe(Math.floor((324 - 24) * (16 / 9))); // limited by height: 533
  });

  it("leaves room below for the footer", async () => {
    size = { width: 1200, height: 500 };
    await render(<VideoPane player={<div>p</div>} footer={<div>badge</div>} />);
    expect(container.textContent).toContain("badge");
    expect(parseInt(playerBox().style.width, 10)).toBe(Math.floor((500 - 24 - 120) * (16 / 9)));
  });

  it("never gets absurdly small", async () => {
    size = { width: 300, height: 100 };
    await render(<VideoPane player={<div>p</div>} />);
    expect(parseInt(playerBox().style.width, 10)).toBe(Math.floor(120 * (16 / 9))); // the smallest height we allow is 120 px
  });
});
