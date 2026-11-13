import { describe, expect, it } from "vitest";
import {
  clamp, DEFAULT_LAYOUT, fitAspect, fractionFromKey, fractionFromPointer, isDefaultLayout, MAX_FRACTION, MIN_FRACTION,
  parseLayout, resolveOrientation,
} from "../split";

describe("orientation", () => {
  it("is side by side on wide screens and stacked on narrow ones", () => {
    expect(resolveOrientation("auto", 1440)).toBe("row");
    expect(resolveOrientation("auto", 1024)).toBe("row");
    expect(resolveOrientation("auto", 1023)).toBe("column"); // tablets
    expect(resolveOrientation("auto", 390)).toBe("column");   // phones
  });
  it("lets the person choose on wide screens, but never forces two columns onto a small one", () => {
    expect(resolveOrientation("column", 1600)).toBe("column");
    expect(resolveOrientation("row", 1600)).toBe("row");
    expect(resolveOrientation("row", 700)).toBe("column");
  });
});

describe("dragging", () => {
  it("turns the pointer position into a share of the container", () => {
    expect(fractionFromPointer(500, 100, 1000)).toBeCloseTo(0.4);
    expect(fractionFromPointer(100, 100, 1000)).toBeCloseTo(0.16); // the 160 px minimum pane size
  });
  it("never lets a pane get smaller than its minimum", () => {
    expect(fractionFromPointer(110, 100, 1000, 160)).toBeCloseTo(0.16); // 160 px of 1000
    expect(fractionFromPointer(5000, 100, 1000, 160)).toBeCloseTo(0.84);
  });
  it("stays inside the allowed range whatever the pointer does", () => {
    for (const pointer of [-5000, 0, 100, 600, 1100, 99999]) {
      const f = fractionFromPointer(pointer, 100, 1000);
      expect(f).toBeGreaterThanOrEqual(MIN_FRACTION);
      expect(f).toBeLessThanOrEqual(MAX_FRACTION);
    }
  });
  it("copes with a container that has no size yet", () => {
    expect(fractionFromPointer(10, 0, 0)).toBe(DEFAULT_LAYOUT.fraction);
    expect(fractionFromPointer(10, 0, NaN)).toBe(DEFAULT_LAYOUT.fraction);
  });
  it("gives each pane half when the container is smaller than both minimums", () => {
    expect(fractionFromPointer(10, 0, 200, 160)).toBeCloseTo(0.5);
  });
});

describe("keyboard", () => {
  it("moves the divider with the arrow keys that match the direction", () => {
    expect(fractionFromKey(0.5, "ArrowRight", "row")).toBeCloseTo(0.52);
    expect(fractionFromKey(0.5, "ArrowLeft", "row")).toBeCloseTo(0.48);
    expect(fractionFromKey(0.5, "ArrowDown", "column")).toBeCloseTo(0.52);
    expect(fractionFromKey(0.5, "ArrowUp", "column")).toBeCloseTo(0.48);
  });
  it("ignores the arrows of the other direction and unrelated keys", () => {
    expect(fractionFromKey(0.5, "ArrowUp", "row")).toBeNull();
    expect(fractionFromKey(0.5, "ArrowLeft", "column")).toBeNull();
    expect(fractionFromKey(0.5, "a", "row")).toBeNull();
  });
  it("jumps to the ends and never leaves the range", () => {
    expect(fractionFromKey(0.5, "Home", "row")).toBe(MIN_FRACTION);
    expect(fractionFromKey(0.5, "End", "row")).toBe(MAX_FRACTION);
    expect(fractionFromKey(MAX_FRACTION, "ArrowRight", "row")).toBe(MAX_FRACTION);
    expect(fractionFromKey(MIN_FRACTION, "ArrowLeft", "row")).toBe(MIN_FRACTION);
  });
});

describe("keeping the video 16:9", () => {
  it("fills the width when there is enough height", () => {
    expect(fitAspect(1600, 1000)).toEqual({ width: 1600, height: 900 });
  });
  it("fills the height when the pane is short (the video gets bars at the sides, never stretched)", () => {
    expect(fitAspect(1600, 450)).toEqual({ width: 800, height: 450 });
  });
  it("always keeps the ratio", () => {
    for (const [w, h] of [[320, 900], [900, 320], [777, 555], [1280, 720], [100, 100]]) {
      const r = fitAspect(w, h);
      expect(r.width).toBeLessThanOrEqual(w);
      expect(r.height).toBeLessThanOrEqual(h);
      expect(Math.abs(r.width / r.height - 16 / 9)).toBeLessThan(0.05);
    }
  });
  it("supports other ratios and empty areas", () => {
    expect(fitAspect(400, 400, 1)).toEqual({ width: 400, height: 400 });
    expect(fitAspect(0, 400)).toEqual({ width: 0, height: 0 });
    expect(fitAspect(400, -1)).toEqual({ width: 0, height: 0 });
  });
});

describe("saved layouts", () => {
  it("round-trips", () => {
    const layout = { orientation: "auto" as const, fraction: 0.6, collapsed: "second" as const };
    expect(parseLayout(JSON.stringify(layout))).toEqual(layout);
  });
  it("drops an orientation saved by the removed Stacked button", () => {
    expect(parseLayout(JSON.stringify({ orientation: "column", fraction: 0.5, collapsed: null })).orientation).toBe("auto");
  });
  it("falls back to the default for missing or damaged values", () => {
    for (const raw of [null, undefined, "", "not json", "[]", "42", "null"]) {
      expect(parseLayout(raw)).toEqual(DEFAULT_LAYOUT);
    }
  });
  it("repairs individual bad fields", () => {
    expect(parseLayout(JSON.stringify({ orientation: "diagonal", fraction: "wide", collapsed: "third" }))).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout(JSON.stringify({ fraction: 5 })).fraction).toBe(MAX_FRACTION);
    expect(parseLayout(JSON.stringify({ fraction: -3 })).fraction).toBe(MIN_FRACTION);
    expect(parseLayout(JSON.stringify({ fraction: null })).fraction).toBe(DEFAULT_LAYOUT.fraction);
  });
  it("knows when the layout is the default", () => {
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, fraction: 0.6 })).toBe(false);
    expect(isDefaultLayout({ ...DEFAULT_LAYOUT, collapsed: "first" })).toBe(false);
  });
  it("clamp works at the edges", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});
