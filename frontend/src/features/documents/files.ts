/** What kinds of files can be uploaded, and checks done in the browser before sending them. */

// Must match the server's list (backend/summarizer/features/documents/rules.py). The server checks again.
export const DOCUMENT_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "odp", "ods", "rtf", "txt", "md", "csv", "png", "jpg", "jpeg", "gif", "webp",
] as const;
export const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm", "mp3", "wav", "m4a"] as const;

export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(",");
export const VIDEO_ACCEPT = VIDEO_EXTENSIONS.map((e) => `.${e}`).join(",") + ",video/*,audio/*";

export type DocumentKind = "pdf" | "word" | "slides" | "sheet" | "text" | "image" | "other";

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

export function documentKind(extension: string): DocumentKind {
  const e = extension.toLowerCase().replace(/^\./, "");
  if (e === "pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf"].includes(e)) return "word";
  if (["ppt", "pptx", "odp"].includes(e)) return "slides";
  if (["xls", "xlsx", "ods", "csv"].includes(e)) return "sheet";
  if (["txt", "md"].includes(e)) return "text";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return "image";
  return "other";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** A message if the file should not be sent, or null if it looks fine. */
export function validateFile(file: { name: string; size: number }, allowed: readonly string[], maxBytes: number): string | null {
  const ext = extensionOf(file.name);
  if (!ext || !allowed.includes(ext)) {
    return `"${file.name}" is not a supported file type. Supported: ${allowed.join(", ")}.`;
  }
  if (file.size <= 0) return `"${file.name}" is empty.`;
  if (file.size > maxBytes) return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.`;
  return null;
}

export function storagePercent(used: number, quota: number): number {
  if (!(quota > 0)) return 0;
  return Math.min(100, Math.round((used / quota) * 100));
}

/** Colours and short labels per kind of file, so each file is recognised at a glance. */
export const KIND_STYLE: Record<DocumentKind, { label: string; bg: string; fg: string }> = {
  pdf: { label: "PDF", bg: "#FDE2E1", fg: "#B42318" },
  word: { label: "DOC", bg: "#DCE8FB", fg: "#1D4ED8" },
  slides: { label: "PPT", bg: "#FDE9D4", fg: "#C2410C" },
  sheet: { label: "XLS", bg: "#DDF3E4", fg: "#15803D" },
  text: { label: "TXT", bg: "#E9E9E6", fg: "#44443F" },
  image: { label: "IMG", bg: "#EBE1FA", fg: "#6D28D9" },
  other: { label: "FILE", bg: "#E9E9E6", fg: "#44443F" },
};

/** Files a browser can show itself (PDF and pictures). */
export function canShowInline(extension: string): boolean {
  return ["pdf", "png", "jpg", "jpeg", "gif", "webp"].includes(extension.toLowerCase().replace(/^\./, ""));
}
