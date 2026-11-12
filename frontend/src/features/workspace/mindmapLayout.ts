import type { MindMapNode } from "../../lib/types";

export type MapView = "outline" | "radial" | "horizontal" | "vertical";

export interface PlacedNode {
  path: string;
  title: string;
  lines: string[];
  depth: number;
  /** Top-left corner and size, in map units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index of the first-level branch this node belongs to (-1 for the centre). */
  branch: number;
  hasChildren: boolean;
  collapsed: boolean;
  /** How many ideas are hidden inside a collapsed node. */
  hiddenCount: number;
}

export interface PlacedLink {
  id: string;
  d: string;
  branch: number;
}

export interface MapLayout {
  nodes: PlacedNode[];
  links: PlacedLink[];
  width: number;
  height: number;
}

const PADDING = 32;
const SIBLING_GAP = 14;
const LEVEL_GAP = 56;
const LINE_HEIGHT = 18;

/** Text without the $...$ markers, for measuring and for the exported image. */
export function plainText(title: string): string {
  return title.replace(/\$+/g, "").replace(/\s+/g, " ").trim();
}

function fontSize(depth: number): number {
  return depth === 0 ? 16 : depth === 1 ? 14 : 13;
}

/** Split text into lines of at most `maxChars` characters (long words are cut). */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function measure(title: string, depth: number): { w: number; h: number; lines: string[] } {
  const text = plainText(title);
  const size = fontSize(depth);
  const charW = size * 0.58;
  const maxW = depth === 0 ? 260 : 210;
  const maxChars = Math.max(6, Math.floor((maxW - 28) / charW));
  const lines = wrapText(text, maxChars).slice(0, 6);
  const longest = Math.max(...lines.map((l) => l.length));
  return { w: Math.round(Math.min(maxW, Math.max(72, longest * charW + 28))), h: lines.length * LINE_HEIGHT + 16, lines };
}

interface Item {
  path: string;
  node: MindMapNode;
  depth: number;
  branch: number;
  kids: Item[];
  w: number;
  h: number;
  lines: string[];
  collapsed: boolean;
  hiddenCount: number;
  // filled in by the layouts
  cx: number;
  cy: number;
}

function countAll(node: MindMapNode): number {
  return 1 + (node.children ?? []).reduce((n, c) => n + countAll(c), 0);
}

/** The visible tree: collapsed nodes keep no children. */
function build(node: MindMapNode, collapsed: Set<string>, path = "0", depth = 0, branch = -1): Item {
  const children = node.children ?? [];
  const isCollapsed = depth > 0 && children.length > 0 && collapsed.has(path);
  const size = measure(node.title, depth);
  const item: Item = {
    path, node, depth, branch, ...size, kids: [], collapsed: isCollapsed,
    hiddenCount: isCollapsed ? countAll(node) - 1 : 0, cx: 0, cy: 0,
  };
  if (!isCollapsed) {
    item.kids = children.map((child, i) => build(child, collapsed, `${path}.${i}`, depth + 1, depth === 0 ? i : branch));
  }
  return item;
}

function flatten(item: Item, out: Item[] = []): Item[] {
  out.push(item);
  item.kids.forEach((k) => flatten(k, out));
  return out;
}

function finish(root: Item, links: PlacedLink[]): MapLayout {
  const items = flatten(root);
  const minX = Math.min(...items.map((i) => i.cx - i.w / 2));
  const minY = Math.min(...items.map((i) => i.cy - i.h / 2));
  const maxX = Math.max(...items.map((i) => i.cx + i.w / 2));
  const maxY = Math.max(...items.map((i) => i.cy + i.h / 2));
  const dx = PADDING - minX;
  const dy = PADDING - minY;
  const shift = (d: string) =>
    d.replace(/(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?),(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/gi, (_m, x, y) => `${(+x + dx).toFixed(1)},${(+y + dy).toFixed(1)}`);
  return {
    nodes: items.map((i) => ({
      path: i.path, title: i.node.title, lines: i.lines, depth: i.depth,
      x: Math.round(i.cx - i.w / 2 + dx), y: Math.round(i.cy - i.h / 2 + dy), w: i.w, h: i.h,
      branch: i.branch, hasChildren: (i.node.children ?? []).length > 0, collapsed: i.collapsed, hiddenCount: i.hiddenCount,
    })),
    links: links.map((l) => ({ ...l, d: shift(l.d) })),
    width: Math.round(maxX - minX + PADDING * 2),
    height: Math.round(maxY - minY + PADDING * 2),
  };
}

/** Left to right ("logic chart") or top down ("org chart") tree. */
function layoutTree(root: Item, vertical: boolean): PlacedLink[] {
  const breadth = (i: Item) => (vertical ? i.w : i.h);
  const depthSize = (i: Item) => (vertical ? i.h : i.w);
  const extent = new Map<Item, number>();
  const measureExtent = (i: Item): number => {
    const kids = i.kids.map(measureExtent);
    const total = kids.reduce((a, b) => a + b, 0) + SIBLING_GAP * Math.max(0, kids.length - 1);
    const e = Math.max(breadth(i), total);
    extent.set(i, e);
    return e;
  };
  measureExtent(root);

  const levelSize: number[] = [];
  flatten(root).forEach((i) => (levelSize[i.depth] = Math.max(levelSize[i.depth] ?? 0, depthSize(i))));
  const offset: number[] = [];
  let acc = 0;
  levelSize.forEach((size, d) => {
    offset[d] = acc + size / 2;
    acc += size + LEVEL_GAP;
  });

  const place = (i: Item, start: number) => {
    const total = i.kids.reduce((a, k) => a + extent.get(k)!, 0) + SIBLING_GAP * Math.max(0, i.kids.length - 1);
    let cursor = start + (extent.get(i)! - total) / 2;
    i.kids.forEach((k) => {
      place(k, cursor);
      cursor += extent.get(k)! + SIBLING_GAP;
    });
    const along = i.kids.length ? (breadthCenter(i.kids[0]) + breadthCenter(i.kids[i.kids.length - 1])) / 2 : start + extent.get(i)! / 2;
    if (vertical) {
      i.cx = along;
      i.cy = offset[i.depth];
    } else {
      i.cy = along;
      i.cx = offset[i.depth];
    }
  };
  const breadthCenter = (i: Item) => (vertical ? i.cx : i.cy);
  place(root, 0);

  const links: PlacedLink[] = [];
  flatten(root).forEach((p) =>
    p.kids.forEach((c) => {
      let d: string;
      if (vertical) {
        const y1 = p.cy + p.h / 2, y2 = c.cy - c.h / 2, mid = (y1 + y2) / 2;
        d = `M ${p.cx},${y1} C ${p.cx},${mid} ${c.cx},${mid} ${c.cx},${y2}`;
      } else {
        const x1 = p.cx + p.w / 2, x2 = c.cx - c.w / 2, mid = (x1 + x2) / 2;
        d = `M ${x1},${p.cy} C ${mid},${p.cy} ${mid},${c.cy} ${x2},${c.cy}`;
      }
      links.push({ id: `${p.path}>${c.path}`, d, branch: c.branch });
    }),
  );
  return links;
}

/** The centre in the middle, branches fanning out in rings. */
function layoutRadial(root: Item): PlacedLink[] {
  const leaves = new Map<Item, number>();
  const countLeaves = (i: Item): number => {
    const n = i.kids.length ? i.kids.reduce((a, k) => a + countLeaves(k), 0) : 1;
    leaves.set(i, n);
    return n;
  };
  countLeaves(root);

  const angle = new Map<Item, number>();
  const span = new Map<Item, number>();
  const assign = (i: Item, from: number, to: number) => {
    angle.set(i, (from + to) / 2);
    span.set(i, to - from);
    let cursor = from;
    i.kids.forEach((k) => {
      const share = ((to - from) * leaves.get(k)!) / leaves.get(i)!;
      assign(k, cursor, cursor + share);
      cursor += share;
    });
  };
  assign(root, -Math.PI / 2, (3 * Math.PI) / 2);

  const items = flatten(root);
  const maxDepth = Math.max(...items.map((i) => i.depth));
  const radius: number[] = [0];
  const hits = (a: Item, b: Item) =>
    Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + 10 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + 10;
  const placeAt = (i: Item, r: number) => {
    const a = angle.get(i)!;
    i.cx = Math.cos(a) * r;
    i.cy = Math.sin(a) * r;
  };
  for (let d = 1; d <= maxDepth; d++) {
    const level = items.filter((i) => i.depth === d);
    const earlier = items.filter((i) => i.depth < d);
    const wide = Math.max(...level.map((i) => i.w));
    const prevWide = Math.max(...items.filter((i) => i.depth === d - 1).map((i) => i.w));
    let r = radius[d - 1] + (d === 1 ? prevWide / 2 + wide / 2 + 40 : wide / 2 + prevWide / 2 + 56);
    // Move the ring outwards until none of its boxes touch each other or an inner ring.
    for (let attempt = 0; attempt < 80; attempt++) {
      level.forEach((i) => placeAt(i, r));
      const clash =
        level.some((a, ai) => level.some((b, bi) => bi > ai && hits(a, b))) ||
        level.some((a) => earlier.some((b) => hits(a, b)));
      if (!clash) break;
      r *= 1.05;
    }
    radius[d] = r;
  }
  items.forEach((i) => placeAt(i, radius[i.depth]));

  const links: PlacedLink[] = [];
  items.forEach((p) =>
    p.kids.forEach((c) => {
      const mid = (radius[p.depth] + radius[c.depth]) / 2;
      const a1 = angle.get(p)!, a2 = angle.get(c)!;
      const d = `M ${p.cx},${p.cy} C ${Math.cos(a1) * mid},${Math.sin(a1) * mid} ${Math.cos(a2) * mid},${Math.sin(a2) * mid} ${c.cx},${c.cy}`;
      links.push({ id: `${p.path}>${c.path}`, d, branch: c.branch });
    }),
  );
  return links;
}

/** Positions for every visible idea, plus the lines between them. */
export function layoutMap(root: MindMapNode, view: Exclude<MapView, "outline">, collapsed: Set<string>): MapLayout {
  const tree = build(root, collapsed);
  const links = view === "radial" ? layoutRadial(tree) : layoutTree(tree, view === "vertical");
  return finish(tree, links);
}

export const BRANCH_COLORS = ["#8FB339", "#38A3D8", "#E8636B", "#E0A526", "#8B6FD6", "#2FA66A"];
export const branchColor = (branch: number) => (branch < 0 ? "#D9EC95" : BRANCH_COLORS[branch % BRANCH_COLORS.length]);

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A standalone SVG picture of the map (plain text, no formulas rendering), for download. */
export function layoutToSvg(layout: MapLayout, dark = false): string {
  const bg = dark ? "#171717" : "#FFFFFF";
  const fg = dark ? "#F5F5F5" : "#111111";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="100%" height="100%" fill="${bg}"/>`,
  ];
  layout.links.forEach((l) => parts.push(`<path d="${l.d}" fill="none" stroke="${branchColor(l.branch)}" stroke-width="2"/>`));
  layout.nodes.forEach((n) => {
    const root = n.depth === 0;
    const color = branchColor(n.branch);
    parts.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" fill="${root ? color : bg}" stroke="${color}" stroke-width="2"/>`);
    const size = fontSize(n.depth);
    n.lines.forEach((line, i) => {
      parts.push(
        `<text x="${n.x + n.w / 2}" y="${n.y + 8 + LINE_HEIGHT * (i + 0.72)}" font-size="${size}" font-weight="${n.depth <= 1 ? 700 : 500}" text-anchor="middle" fill="${root ? "#0E0F0C" : fg}">${xmlEscape(line)}</text>`,
      );
    });
  });
  parts.push("</svg>");
  return parts.join("");
}
