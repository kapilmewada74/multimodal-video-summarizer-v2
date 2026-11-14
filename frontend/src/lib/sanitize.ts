import DOMPurify from "dompurify";

/**
 * Escape text so it is safe to place inside HTML (element content or a
 * quoted attribute).
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Clean untrusted HTML (AI output, rendered markdown, KaTeX output) before it
 * is inserted into the page.
 *
 * It keeps the formatting, MathML and inline styles that KaTeX needs, and
 * removes scripts, event handlers and `javascript:` links.
 *
 * Outside a browser (during server rendering) no DOM is available, so the
 * input is escaped instead. The result is always safe, just unformatted.
 */
/** CSS that could cover the page (a fake login box over a shared summary) or load something from elsewhere. */
const DANGEROUS_CSS = /position\s*:|z-index|url\s*\(|expression\s*\(|@import|behavior\s*:|-moz-binding|\bfixed\b|\bsticky\b/i;

let hooked = false;
function installHooks(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    // Inline styles are only needed for the spacing KaTeX writes into its own formulas. Anywhere else (text an AI or a
    // person wrote) they are removed, so shared content cannot lay an overlay over the page.
    if (node.hasAttribute("style")) {
      const insideFormula = Boolean(node.closest(".katex, .katex-display, .katex-html, .katex-mathml"));
      if (!insideFormula || DANGEROUS_CSS.test(node.getAttribute("style") ?? "")) node.removeAttribute("style");
    }
    if (node.tagName === "A") {
      node.setAttribute("rel", "noopener noreferrer nofollow");
      if (node.getAttribute("target") && node.getAttribute("target") !== "_blank") node.removeAttribute("target");
    }
  });
}

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined" || !DOMPurify.isSupported) {
    return escapeHtml(html);
  }
  installHooks();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc", "formaction"],
  });
}
