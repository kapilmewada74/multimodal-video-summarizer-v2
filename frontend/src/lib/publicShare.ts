import type { PublicVideo } from "./types";

/** Share tokens are 32-64 URL-safe characters. Checked before the token goes into a request address. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

const BACKEND = () => (process.env.BACKEND_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

/**
 * The public face of a share link, read on the server so the page can say what it is when someone pastes it into
 * WhatsApp, Telegram, Slack and so on. The API already limits this to what the owner chose to share. Null when the link
 * is turned off, wrong, or the API cannot be reached (the page then simply gets the general site description).
 */
export async function fetchPublicShare(token: string): Promise<PublicVideo | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  try {
    const res = await fetch(`${BACKEND()}/api/public/${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok ? ((await res.json()) as PublicVideo) : null;
  } catch {
    return null;
  }
}

/** The first lines of a Markdown summary as plain text, for a link preview. */
export function plainExcerpt(markdown: string | null | undefined, max = 180): string {
  const source = markdown ?? "";
  // Headings ("Overview") make a poor first line of a preview: skip them when there is real text underneath.
  const body = source.replace(/^\s{0,3}#{1,6}\s.*$/gm, "");
  return excerptOf(body.trim() ? body : source, max);
}

function excerptOf(markdown: string, max: number): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, " ")        // formulas
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")                 // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")               // links keep their words
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")                    // heading marks
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")               // bullets
    .replace(/[*_`>~]+/g, "")
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, "")          // [04:15] timestamps
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).trimEnd()}…`;
}

/** True when most letters are Latin: the card image's built-in font can draw the title. */
export function isLatinTitle(title: string): boolean {
  const letters = Array.from(title).filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return true;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return latin / letters.length >= 0.8;
}

export function clampTitle(title: string, max = 96): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
