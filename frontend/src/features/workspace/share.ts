/** The public page address for a share token. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${encodeURIComponent(token)}`;
}

/** One short line about what the link holds, in the same words everywhere. */
export const SHARE_TAGLINE = "Study notes made with SUMMARIZE.AI: summary, mind map and flashcards.";

const heading = (title: string | null) => `\u{1F4DA} ${title?.trim() || "Study notes"}`;

/** The message people see in WhatsApp, e-mail and the phone's share sheet. */
export function shareMessage(title: string | null, url: string): string {
  return `${heading(title)}\n\n${SHARE_TAGLINE}\n${url}`;
}

/** A WhatsApp "send this message" link (works on phone and web). */
export function whatsappUrl(title: string | null, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(shareMessage(title, url))}`;
}

export function telegramUrl(title: string | null, url: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${heading(title)}\n${SHARE_TAGLINE}`)}`;
}

/** X (Twitter) keeps posts short, so the text is the title only; the link card carries the rest. */
export function xUrl(title: string | null, url: string): string {
  const text = `${heading(title)} \u2014 study notes`.slice(0, 200);
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function linkedinUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

export function emailUrl(title: string | null, url: string): string {
  return `mailto:?subject=${encodeURIComponent(`Study notes: ${title?.trim() || "a video"}`)}&body=${encodeURIComponent(shareMessage(title, url))}`;
}

/** What the phone's own share sheet (the Web Share API) is given. */
export function nativeSharePayload(title: string | null, url: string): { title: string; text: string; url: string } {
  return { title: title?.trim() || "Study notes", text: `${heading(title)}\n${SHARE_TAGLINE}`, url };
}

/** Only real YouTube video ids are embedded. */
export function isYouTubeId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
}
