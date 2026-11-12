import { describe, expect, it } from "vitest";
import type { MindMapNode } from "../../../lib/types";
import { fitTransform } from "../MindMapCanvas";
import { layoutMap, layoutToSvg, measure, plainText, wrapText, type MapLayout, type PlacedNode } from "../mindmapLayout";

const leaf = (title: string): MindMapNode => ({ title, children: [] });
const node = (title: string, ...children: MindMapNode[]): MindMapNode => ({ title, children });

function bigMap(): MindMapNode {
  return node("Gradient descent",
    ...["Idea", "Learning rate", "Variants", "Pitfalls", "Maths", "Practice"].map((t) =>
      node(t, ...[1, 2, 3, 4].map((i) => node(`${t} point ${i} with a rather long explanation of the point`, leaf(`detail $x_${i}$`), leaf("another detail"))))),
  );
}

const overlap = (a: PlacedNode, b: PlacedNode) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectNoOverlaps(layout: MapLayout) {
  for (let i = 0; i < layout.nodes.length; i++)
    for (let j = i + 1; j < layout.nodes.length; j++)
      expect(overlap(layout.nodes[i], layout.nodes[j]), `${layout.nodes[i].path} overlaps ${layout.nodes[j].path}`).toBe(false);
}

describe.each(["radial", "horizontal", "vertical"] as const)("%s layout", (view) => {
  it("places every idea once, without overlaps, and connects each to its parent", () => {
    const map = bigMap();
    const layout = layoutMap(map, view, new Set());
    expect(layout.nodes).toHaveLength(1 + 6 + 24 + 48);
    expect(new Set(layout.nodes.map((n) => n.path)).size).toBe(layout.nodes.length);
    expect(layout.links).toHaveLength(layout.nodes.length - 1);
    expectNoOverlaps(layout);
  });

  it("keeps everything inside the reported size", () => {
    const layout = layoutMap(bigMap(), view, new Set());
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.h).toBeLessThanOrEqual(layout.height);
    }
  });

  it("hides the contents of a collapsed idea and says how many", () => {
    const layout = layoutMap(bigMap(), view, new Set(["0.0"]));
    const collapsed = layout.nodes.find((n) => n.path === "0.0")!;
    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.hiddenCount).toBe(4 + 8);
    expect(layout.nodes.some((n) => n.path.startsWith("0.0."))).toBe(false);
    expect(layout.nodes).toHaveLength(1 + 6 + 24 + 48 - 12);
  });

  it("handles a map that is only a centre", () => {
    const layout = layoutMap(leaf("Alone"), view, new Set());
    expect(layout.nodes).toHaveLength(1);
    expect(layout.links).toHaveLength(0);
    expect(layout.width).toBeGreaterThan(0);
  });

  it("gives every link valid numbers", () => {
    for (const l of layoutMap(bigMap(), view, new Set()).links) expect(l.d).not.toMatch(/NaN|Infinity|e-/);
  });
});

describe("layout shapes", () => {
  const small = node("Centre", node("A", leaf("a1"), leaf("a2")), node("B", leaf("b1")));

  it("left to right: children are to the right of their parent", () => {
    const layout = layoutMap(small, "horizontal", new Set());
    const by = Object.fromEntries(layout.nodes.map((n) => [n.path, n]));
    expect(by["0.0"].x).toBeGreaterThan(by["0"].x + by["0"].w);
    expect(by["0.0.0"].x).toBeGreaterThan(by["0.0"].x + by["0.0"].w);
  });

  it("top down: children are below their parent", () => {
    const layout = layoutMap(small, "vertical", new Set());
    const by = Object.fromEntries(layout.nodes.map((n) => [n.path, n]));
    expect(by["0.0"].y).toBeGreaterThan(by["0"].y + by["0"].h);
  });

  it("radial: branches surround the centre instead of sitting on one side", () => {
    const layout = layoutMap(bigMap(), "radial", new Set());
    const root = layout.nodes.find((n) => n.path === "0")!;
    const cx = root.x + root.w / 2, cy = root.y + root.h / 2;
    const firsts = layout.nodes.filter((n) => n.depth === 1);
    expect(firsts.some((n) => n.x + n.w / 2 < cx)).toBe(true);
    expect(firsts.some((n) => n.x + n.w / 2 > cx)).toBe(true);
    expect(firsts.some((n) => n.y + n.h / 2 < cy)).toBe(true);
    expect(firsts.some((n) => n.y + n.h / 2 > cy)).toBe(true);
  });

  it("each first-level branch has its own colour group", () => {
    const layout = layoutMap(small, "horizontal", new Set());
    const by = Object.fromEntries(layout.nodes.map((n) => [n.path, n]));
    expect(by["0"].branch).toBe(-1);
    expect([by["0.0"].branch, by["0.0.1"].branch, by["0.1"].branch, by["0.1.0"].branch]).toEqual([0, 0, 1, 1]);
  });
});

describe("text helpers", () => {
  it("wraps long text and cuts very long words", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(wrapText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrapText("", 10)).toEqual([""]);
  });

  it("measures without the dollar signs and keeps boxes within limits", () => {
    expect(plainText("Use $x^2$ here")).toBe("Use x^2 here");
    const m = measure("word ".repeat(80), 2);
    expect(m.w).toBeLessThanOrEqual(210);
    expect(m.lines.length).toBeLessThanOrEqual(6);
    expect(measure("hi", 3).w).toBeGreaterThanOrEqual(72);
  });
});

describe("svg export", () => {
  it("escapes text so titles cannot inject markup", () => {
    const layout = layoutMap(node('<img src=x onerror="alert(1)"> & "q"', leaf("ok")), "horizontal", new Set());
    const svg = layoutToSvg(layout);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;img");
    expect(svg).toContain("&amp;");
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("fitTransform", () => {
  it("fits a big map into a small box, centred", () => {
    const t = fitTransform({ width: 2000, height: 1000 }, { width: 500, height: 500 });
    expect(t.k).toBeCloseTo(0.25);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(125);
  });
  it("does not blow a tiny map up too far, and survives an empty box", () => {
    expect(fitTransform({ width: 100, height: 100 }, { width: 800, height: 800 }).k).toBeLessThanOrEqual(1.1);
    expect(fitTransform({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ k: 1, x: 0, y: 0 });
  });
});
