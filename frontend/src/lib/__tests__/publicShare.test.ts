import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_PATTERN, clampTitle, fetchPublicShare, isLatinTitle, plainExcerpt } from "../publicShare";

const TOKEN = "a".repeat(40);

afterEach(() => vi.unstubAllGlobals());

describe("plainExcerpt (the text of a link preview)", () => {
  it("turns Markdown into plain words and skips headings", () => {
    const md = "## Overview\n\nFeature scaling puts **numeric features** on one range, see [the docs](https://x.y).\n\n- Normalization\n- Standardization";
    expect(plainExcerpt(md, 200)).toBe("Feature scaling puts numeric features on one range, see the docs. Normalization Standardization");
  });

  it("drops formulas, code, images and timestamps", () => {
    expect(plainExcerpt("Use $x^2$ and $$y=1$$ here ![img](a.png) [04:15] done ```code``` ok", 200)).toBe("Use and here done ok");
  });

  it("cuts long text at a word and adds an ellipsis", () => {
    const out = plainExcerpt("word ".repeat(100), 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/);
  });

  it("keeps a heading when it is all there is", () => {
    expect(plainExcerpt("# Only a heading", 100)).toBe("Only a heading");
  });

  it("copes with nothing", () => {
    expect(plainExcerpt(null)).toBe("");
    expect(plainExcerpt("", 10)).toBe("");
  });
});

describe("titles on the card picture", () => {
  it("knows when the card font can draw a title", () => {
    expect(isLatinTitle("Feature Scaling | Normalization")).toBe(true);
    expect(isLatinTitle("Lecture 5: déjà vu")).toBe(true);
    expect(isLatinTitle("जीवन में खोया हुआ महसूस करें")).toBe(false);
    expect(isLatinTitle("12345")).toBe(true);
  });

  it("shortens very long titles", () => {
    expect(clampTitle("x".repeat(300), 50).length).toBe(50);
    expect(clampTitle("  a   b  ")).toBe("a b");
  });
});

describe("reading a share on the server", () => {
  it("accepts only real tokens, so nothing odd goes into the request address", () => {
    expect(TOKEN_PATTERN.test(TOKEN)).toBe(true);
    for (const bad of ["short", "../../etc/passwd" + "a".repeat(30), `${TOKEN}/x`, `${TOKEN}?x=1`, "a".repeat(65), ""]) expect(TOKEN_PATTERN.test(bad), bad).toBe(false);
  });

  it("does not call the API for a bad token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchPublicShare("../nope")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the shared video, and null when the link is off or the API is down", async () => {
    const video = { title: "T", summary: "S", youtube_id: null, duration: 1, mindmap: null, flashcards: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => video }));
    expect(await fetchPublicShare(TOKEN)).toEqual(video);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchPublicShare(TOKEN)).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await fetchPublicShare(TOKEN)).toBeNull();
  });
});
