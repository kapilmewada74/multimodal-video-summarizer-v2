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
export function sanitizeHtml(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined" || !DOMPurify.isSupported) {
    return escapeHtml(html);
  }
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["srcdoc", "formaction"],
  });
}
