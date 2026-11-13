import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../[token]/SharedView", () => ({ SharedView: () => null }));
import { generateMetadata } from "../[token]/page";

const TOKEN = "t".repeat(40);
const params = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

afterEach(() => vi.unstubAllGlobals());

describe("what a pasted share link looks like", () => {
  it("names the video and describes it with the start of the summary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: "Feature Scaling", summary: "## Overview\n\nScaling puts features on one range.", youtube_id: null, duration: 1, mindmap: null, flashcards: null }) }));
    const meta = await generateMetadata(params());
    expect(meta.title).toBe("Feature Scaling");
    expect(meta.description).toBe("Scaling puts features on one range.");
    expect(meta.openGraph).toMatchObject({ type: "article", title: "Feature Scaling · Study notes", url: `/s/${TOKEN}` });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("keeps shared notes out of search engines", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ title: "T", summary: "S", youtube_id: null, duration: 1, mindmap: null, flashcards: null }) }));
    expect((await generateMetadata(params())).robots).toEqual({ index: false, follow: false });
  });

  it("falls back to a general description when the link is off or the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const meta = await generateMetadata(params());
    expect(meta.title).toBe("Shared study notes");
    expect(String(meta.description)).toContain("SUMMARIZE.AI");
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("never reads the API for a malformed token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await generateMetadata(params("../x"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
