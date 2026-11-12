/** The public page address for a share token. */
export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/s/${encodeURIComponent(token)}`;
}

/** A WhatsApp "send this message" link (works on phone and web). */
export function whatsappUrl(title: string | null, url: string): string {
  const text = `${title ? `${title}\n` : ""}Study notes: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Only real YouTube video ids are embedded. */
export function isYouTubeId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{11}$/.test(value);
}

export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
}
