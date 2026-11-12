// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ActionMenu } from "../ui/ActionMenu";
import { IconButton } from "../ui/IconButton";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("IconButton", () => {
  it("has no visible text but is labelled for tooltips and screen readers", () => {
    act(() => root.render(<IconButton label="Copy the summary"><svg /></IconButton>));
    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Copy the summary");
    expect(button.getAttribute("title")).toBe("Copy the summary");
    expect(button.textContent).toBe("");
    expect(button.getAttribute("type")).toBe("button");
  });
});

describe("ActionMenu", () => {
  const mount = (onPdf = vi.fn(), onTxt = vi.fn()) =>
    act(() => root.render(
      <ActionMenu label="Download" icon={<svg />} heading="Download as"
        items={[{ key: "pdf", label: "PDF", onSelect: onPdf }, { key: "txt", label: "Text", onSelect: onTxt }, { key: "off", label: "Disabled", onSelect: () => {}, disabled: true }]} />,
    ));
  const trigger = () => container.querySelector("[aria-haspopup=menu]") as HTMLButtonElement;
  const items = () => [...container.querySelectorAll("[role=menuitem]")] as HTMLButtonElement[];

  it("is closed until opened, then lists its choices", () => {
    mount();
    expect(container.querySelector("[role=menu]")).toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(items().map((i) => i.textContent)).toEqual(["PDF", "Text", "Disabled"]);
    expect(container.textContent).toContain("Download as");
  });

  it("runs the chosen action and closes", () => {
    const onPdf = vi.fn();
    mount(onPdf);
    act(() => trigger().click());
    act(() => items()[0].click());
    expect(onPdf).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[role=menu]")).toBeNull();
  });

  it("does not run disabled items", () => {
    mount();
    act(() => trigger().click());
    expect(items()[2].disabled).toBe(true);
  });

  it("moves with the arrow keys, skipping disabled items, and closes with Escape giving focus back", () => {
    mount();
    act(() => trigger().click());
    expect(document.activeElement).toBe(items()[0]); // first item is focused on open
    act(() => { items()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement).toBe(items()[1]);
    act(() => { items()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement).toBe(items()[0]); // wraps past the disabled one
    act(() => { items()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
    expect(document.activeElement).toBe(items()[1]);
    act(() => { items()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(container.querySelector("[role=menu]")).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a click outside", () => {
    mount();
    act(() => trigger().click());
    act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    expect(container.querySelector("[role=menu]")).toBeNull();
  });

  describe("placement", () => {
    const rect = (over: Partial<DOMRect>): DOMRect => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}), ...over } as DOMRect);

    function place(trigger: Partial<DOMRect>, { innerHeight = 600, innerWidth = 1000, menuHeight = 200, menuWidth = 240 } = {}) {
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(innerHeight);
      vi.spyOn(window, "innerWidth", "get").mockReturnValue(innerWidth);
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(menuWidth);
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(menuHeight);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this.getAttribute("aria-haspopup") ? rect(trigger) : rect({});
      });
      mount();
      act(() => trigger_().click());
      const el = container.querySelector("[role=menu]") as HTMLElement;
      return { top: parseFloat(el.style.top), left: parseFloat(el.style.left), maxHeight: parseFloat(el.style.maxHeight) };
    }
    const trigger_ = () => container.querySelector("[aria-haspopup=menu]") as HTMLButtonElement;
    afterEach(() => vi.restoreAllMocks());

    it("opens below the button when there is room, lined up with its right edge", () => {
      const p = place({ top: 100, bottom: 136, left: 700, right: 736 });
      expect(p.top).toBe(142);
      expect(p.left).toBe(736 - 240);
    });

    it("opens ABOVE the button near the bottom of the screen, so it is never cut off", () => {
      const p = place({ top: 540, bottom: 576, left: 700, right: 736 });
      expect(p.top).toBeLessThan(540);
      expect(p.top + 200).toBeLessThanOrEqual(540);
    });

    it("stays inside the screen on the left", () => {
      expect(place({ top: 100, bottom: 136, left: 0, right: 30 }).left).toBe(8);
    });

    it("stays inside the screen on the right", () => {
      expect(place({ top: 100, bottom: 136, left: 990, right: 1020 }, { innerWidth: 1000 }).left).toBe(1000 - 240 - 8);
    });

    it("is scrollable when even the larger side is too small", () => {
      const p = place({ top: 200, bottom: 236 }, { innerHeight: 300, menuHeight: 400 });
      expect(p.maxHeight).toBeGreaterThanOrEqual(120);
      expect(p.maxHeight).toBeLessThan(400);
    });

    it("closes when the page scrolls under it, but not when the menu itself scrolls", () => {
      place({ top: 100, bottom: 136, left: 700, right: 736 });
      act(() => { (container.querySelector("[role=menu]") as HTMLElement).dispatchEvent(new Event("scroll")); });
      expect(container.querySelector("[role=menu]")).not.toBeNull();
      act(() => { document.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("scroll")); });
      expect(container.querySelector("[role=menu]")).toBeNull();
    });
  });
});
