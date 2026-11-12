import { describe, expect, it } from "vitest";
import type { MindMapNode } from "../../../lib/types";
import { countNodes, initialCollapsed, maxDepth, mindmapToMarkdown } from "../mindmap";
import { isYouTubeId, shareUrl, whatsappUrl, youtubeEmbedUrl } from "../share";

const tree: MindMapNode = {
  title: "Root",
  children: [
    { title: "A", children: [{ title: "A1", children: [{ title: "A1a", children: [] }] }, { title: "A2", children: [] }] },
    { title: "B", children: [] },
  ],
};

describe("mind map helpers", () => {
  it("writes an indented outline", () => {
    expect(mindmapToMarkdown(tree)).toBe("- Root\n  - A\n    - A1\n      - A1a\n    - A2\n  - B");
  });
  it("counts nodes and depth", () => {
    expect(countNodes(tree)).toBe(6);
    expect(maxDepth(tree)).toBe(4);
    expect(maxDepth({ title: "x", children: [] })).toBe(1);
  });
  it("starts with the first two levels open and deeper branches collapsed", () => {
    const collapsed = initialCollapsed(tree, 2);
    expect(collapsed.has("0.0.0")).toBe(true); // A1 has a child and is at level 2
    expect(collapsed.has("0")).toBe(false);
    expect(collapsed.has("0.0")).toBe(false);
    expect(collapsed.has("0.1")).toBe(false); // B has no children, nothing to collapse
  });
  it("copes with a missing children list", () => {
    const broken = { title: "x" } as unknown as MindMapNode;
    expect(mindmapToMarkdown(broken)).toBe("- x");
    expect(countNodes(broken)).toBe(1);
  });
});

describe("sharing helpers", () => {
  it("builds the public page address", () => {
    expect(shareUrl("https://app.example.com/", "abc_DEF-123")).toBe("https://app.example.com/s/abc_DEF-123");
  });
  it("encodes the token", () => {
    expect(shareUrl("https://x.io", "a/b")).toBe("https://x.io/s/a%2Fb");
  });
  it("builds a WhatsApp link with the title and address", () => {
    const link = whatsappUrl("Physics & Math: Lecture 1", "https://app.example.com/s/tok");
    expect(link.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(link.slice("https://wa.me/?text=".length));
    expect(text).toBe("Physics & Math: Lecture 1\nStudy notes: https://app.example.com/s/tok");
  });
  it("works without a title", () => {
    expect(decodeURIComponent(whatsappUrl(null, "https://a.b/s/t").split("text=")[1])).toBe("Study notes: https://a.b/s/t");
  });
});

describe("YouTube embedding", () => {
  it("accepts only real video ids", () => {
    expect(isYouTubeId("dQw4w9WgXcQ")).toBe(true);
    for (const bad of [null, undefined, "", "short", "dQw4w9WgXcQ1", "dQw4w9WgXc\"", 'x"><script>', "javascript:aler"]) {
      expect(isYouTubeId(bad as string)).toBe(false);
    }
  });
  it("uses the privacy-friendly embed address", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  });
});
