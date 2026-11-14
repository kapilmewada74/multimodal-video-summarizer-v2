// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderKatexToString, renderMarkdownWithMath, renderMathInHtml } from "../mathUtils";
import { escapeHtml, sanitizeHtml } from "../sanitize";

/** True if the HTML would run script when inserted into a page. */
function isDangerous(html: string): boolean {
  const box = document.createElement("div");
  box.innerHTML = html;
  if (box.querySelector("script, iframe, object, embed, form")) return true;
  for (const el of Array.from(box.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) return true;
      if (
        /^(href|src|xlink:href|action|formaction)$/i.test(attr.name) &&
        /^\s*(javascript|data):/i.test(attr.value)
      ) {
        return true;
      }
    }
  }
  return false;
}

describe("HTML sanitising of AI output", () => {
  const attacks: [string, string][] = [
    ["img onerror", 'Hello <img src=x onerror="alert(1)"> world'],
    ["script tag", "<script>alert(1)</script>text"],
    ["javascript link", "[click](javascript:alert(1))"],
    ["svg onload", '<svg onload="alert(1)"></svg>'],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
  ];

  it.each(attacks)("markdown rendering removes: %s", (_name, payload) => {
    expect(isDangerous(renderMarkdownWithMath(payload))).toBe(false);
  });

  it("keeps normal formatting", () => {
    const html = renderMarkdownWithMath("# Title\n\n- **bold** item");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("still renders inline and display math", () => {
    expect(renderMarkdownWithMath("Energy $E=mc^2$ here")).toContain("katex");
    expect(renderMarkdownWithMath("$$\\sum_{i=1}^n i$$")).toContain("katex-display");
  });

  it("escapes broken LaTeX instead of inserting it as HTML", () => {
    const html = renderKatexToString("\\frac{<img src=x onerror=alert(1)>", false);
    expect(isDangerous(html)).toBe(false);
  });

  it("does not turn KaTeX \\href into a live javascript link", () => {
    const html = renderKatexToString("\\href{javascript:alert(1)}{click}", false);
    expect(isDangerous(html)).toBe(false);
  });

  it("cleans text mixed with math", () => {
    const html = renderMathInHtml("<b>hi</b> $x^2$ <img src=x onerror=alert(1)>");
    expect(isDangerous(html)).toBe(false);
    expect(html).toContain("katex");
  });

  it("escapeHtml neutralises markup and quotes", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  it("sanitizeHtml of empty input is empty", () => {
    expect(sanitizeHtml("")).toBe("");
  });
});

describe("styles and links in untrusted HTML", () => {
  it("removes inline styles from ordinary content, so nothing can be laid over the page", () => {
    const out = sanitizeHtml('<div style="position:fixed;inset:0;background:white;z-index:9999">Sign in to continue</div><p style="color:red">x</p>');
    expect(out).not.toContain("style=");
    expect(out).toContain("Sign in to continue");
  });

  it("keeps the spacing styles KaTeX writes inside its own formulas", () => {
    const out = sanitizeHtml('<span class="katex"><span class="base" style="height:0.64em;vertical-align:-0.08em"><span class="mord">x</span></span></span>');
    expect(out).toContain('style="height:0.64em;vertical-align:-0.08em"');
  });

  it("still strips dangerous CSS from inside a formula", () => {
    const out = sanitizeHtml('<span class="katex"><span class="base" style="position:fixed;top:0;left:0;width:100vw">x</span><span style="background:url(https://evil.example/p.png)">y</span></span>');
    expect(out).not.toMatch(/position|url\(/i);
    expect(out).toContain("x");
  });

  it("marks every link so it cannot reach back to the page that opened it", () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">a</a><a href="https://example.com" target="_top">b</a>');
    expect(out.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(2);
    expect(out).not.toContain("_top");
  });
});

describe("real KaTeX output survives the stricter rules", () => {
  it("still has the spacing styles after rendering and cleaning", () => {
    const html = renderMathInHtml("Energy is $E = mc^2$ and $$\\frac{a}{b}$$");
    expect(html).toContain("katex");
    expect(html).toMatch(/style="[^"]*(height|vertical-align|top|margin)/);
    expect(html).not.toMatch(/position\s*:/);
  });
});
