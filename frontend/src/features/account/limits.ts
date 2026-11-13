/** What /api/me/limits returns: today's usage and every limit that applies to the signed-in person. */
export interface AccountLimits {
  videos: { used: number; limit: number; remaining: number; resets_at: string };
  generations: { used: number; limit: number; resets_at: string };
  uploads: { max_bytes: number; extensions: string[]; max_video_seconds: number };
  documents: { max_bytes: number; max_count: number; count: number; extensions: string[] };
  storage: { used_bytes: number; quota_bytes: number };
}

/** 524288000 -> "500 MB". Whole numbers when they are whole, one decimal otherwise. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = Number.isInteger(value) || value >= 100 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${units[unit]}`;
}

/** 10800 -> "3 hours", 5400 -> "1 hour 30 minutes", 90 -> "1 minute 30 seconds". */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (h) parts.push(part(h, "hour"));
  if (m) parts.push(part(m, "minute"));
  if (!h && !m) parts.push(part(s, "second"));
  else if (!h && s) parts.push(part(s, "second"));
  return parts.join(" ");
}

/** ".mp4" -> "MP4", as a readable list: "MP4, MOV and MKV". */
export function formatExtensions(extensions: string[]): string {
  const names = extensions.map((e) => e.replace(/^\./, "").toUpperCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Share of the limit used, 0 to 100 (a limit of 0 counts as full). */
export function percent(used: number, limit: number): number {
  if (!(limit > 0)) return used > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}
