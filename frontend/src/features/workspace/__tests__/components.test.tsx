// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MindMapData } from "../../../lib/types";
import { MindMapView } from "../MindMapView";
import { VideoPlayer } from "../VideoPlayer";

/** True if the HTML would run script when inserted into a page. */
function isDangerous(html: string): boolean {
  const box = document.createElement("div");
  box.innerHTML = html;
  if (box.querySelector("script, iframe, object, embed, form")) return true;
  for (const el of Array.from(box.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) return true;
      if (/^(href|src|xlink:href|action)$/i.test(attr.name) && /^\s*(javascript|data):/i.test(attr.value)) return true;
    }
  }
  return false;
}

const hostile: MindMapData = {
  title: '<img src=x onerror="alert(1)">',
  children: [
    { title: "<script>alert(1)</script>", children: [] },
    { title: '"><svg onload=alert(1)>', children: [{ title: "$\\href{javascript:alert(1)}{click}$", children: [] }] },
    { title: "Normal branch", children: [] },
  ],
};

describe("MindMapView", () => {
  it("never turns a node title into executable HTML", () => {
    const html = renderToStaticMarkup(<MindMapView data={hostile} />);
    expect(isDangerous(html)).toBe(false);
    expect(html).toContain("Normal branch");
  });

  it("shows the root, branches and an idea count", () => {
    const html = renderToStaticMarkup(
      <MindMapView data={{ title: "Root", children: [{ title: "A", children: [{ title: "A1", children: [] }] }] }} />,
    );
    expect(html).toContain("Root");
    expect(html).toContain("A");
    expect(html).toContain("3 ideas");
  });

  it("renders formulas in titles", () => {
    const html = renderToStaticMarkup(<MindMapView data={{ title: "Energy", children: [{ title: "$E=mc^2$", children: [] }] }} />);
    expect(html).toContain("katex");
  });

  it("offers generation only where the user can generate", () => {
    expect(renderToStaticMarkup(<MindMapView data={null} onGenerate={() => undefined} />)).toContain("Generate mind map");
    expect(renderToStaticMarkup(<MindMapView data={null} />)).toContain("No mind map yet.");
    expect(renderToStaticMarkup(<MindMapView data={null} isLoading />)).toContain("Building your mind map");
  });

  it("hides regenerate on the read-only public view", () => {
    const data: MindMapData = { title: "R", children: [{ title: "A", children: [] }] };
    expect(renderToStaticMarkup(<MindMapView data={data} />)).not.toContain("Regenerate");
    expect(renderToStaticMarkup(<MindMapView data={data} onGenerate={() => undefined} />)).toContain("Regenerate");
  });

  it("copes with a map whose children are missing", () => {
    const broken = { title: "Only root" } as unknown as MindMapData;
    expect(() => renderToStaticMarkup(<MindMapView data={broken} />)).not.toThrow();
  });
});

describe("VideoPlayer", () => {
  it("embeds a real YouTube id with the privacy-friendly player", () => {
    const html = renderToStaticMarkup(<VideoPlayer youtubeId="dQw4w9WgXcQ" title="Demo" />);
    expect(html).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(html).toContain("allowFullScreen");
  });

  it.each(['x"><script>alert(1)</script>', "javascript:alert(1)", "tooshort", ""])(
    "never embeds an invalid id: %s",
    (bad) => {
      const html = renderToStaticMarkup(<VideoPlayer youtubeId={bad} title="Demo" />);
      expect(html).not.toContain("<iframe");
      expect(isDangerous(html)).toBe(false);
    },
  );

  it("explains that uploaded files have no preview", () => {
    expect(renderToStaticMarkup(<VideoPlayer youtubeId={null} title={null} />)).toContain("uploaded as a file");
  });

  it("does not put the video title into markup unescaped", () => {
    const html = renderToStaticMarkup(<VideoPlayer youtubeId="dQw4w9WgXcQ" title={'"><script>x</script>'} />);
    const box = document.createElement("div");
    box.innerHTML = html;
    expect(box.querySelector("script")).toBeNull();
    const frames = Array.from(box.querySelectorAll("iframe"));
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
    expect(frames[0].getAttribute("title")).toContain("<script>"); // kept as plain text, not markup
  });
});
