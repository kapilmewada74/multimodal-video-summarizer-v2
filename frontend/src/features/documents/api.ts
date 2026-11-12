import { apiFetch, readError } from "../../lib/api";
import { uploadErrorMessage, uploadWithProgress } from "../../lib/upload";
import { DOCUMENT_EXTENSIONS, validateFile } from "./files";

export interface ViewInfo {
  url: string;
  kind: "pdf" | "image";
}

/** A temporary address for showing a PDF or picture inside the page, or null if this file cannot be shown that way. */
export async function getViewInfo(documentId: string): Promise<ViewInfo | null> {
  const res = await apiFetch(`/api/documents/${documentId}/view-url`);
  if (res.status === 415) return null;
  if (!res.ok) throw new Error(await readError(res, "Could not open this file."));
  return (await res.json()) as ViewInfo;
}

export async function getText(documentId: string): Promise<string> {
  const res = await apiFetch(`/api/documents/${documentId}/text`);
  if (!res.ok) throw new Error(await readError(res, "Could not read this file."));
  return ((await res.json()) as { text: string }).text;
}

/** Starts a browser download of the original file. */
export async function downloadDocument(doc: { id: string; filename: string }): Promise<void> {
  const res = await apiFetch(`/api/documents/${doc.id}/download-url`);
  if (!res.ok) throw new Error(await readError(res, "Could not start the download."));
  const { url } = await res.json();
  const a = document.createElement("a");
  a.href = url;
  a.download = doc.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface UploadProgress {
  key: string;
  name: string;
  progress: number;
  error?: string;
}

/**
 * Uploads files one after another to `endpoint`, reporting progress. Checks each file in the browser first.
 * Returns how many were stored.
 */
export async function uploadDocuments(options: {
  files: File[];
  endpoint: string;
  /** Extra form fields, for example `{ playlist_item_id }`. */
  fields?: Record<string, string>;
  maxBytes: number;
  onProgress: (update: (list: UploadProgress[]) => UploadProgress[]) => void;
  onToast: (message: string, type?: "success" | "info" | "error") => void;
}): Promise<number> {
  const { files, endpoint, fields = {}, maxBytes, onProgress, onToast } = options;
  let stored = 0;
  for (const file of files) {
    const problem = validateFile(file, DOCUMENT_EXTENSIONS, maxBytes);
    if (problem) {
      onToast(problem, "error");
      continue;
    }
    const key = `${file.name}-${file.size}-${Math.random()}`;
    onProgress((list) => [...list, { key, name: file.name, progress: 0 }]);
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append("file", file);
    try {
      const result = await uploadWithProgress(endpoint, form, (progress) =>
        onProgress((list) => list.map((x) => (x.key === key ? { ...x, progress } : x))));
      if (result.status >= 200 && result.status < 300) {
        stored += 1;
        onProgress((list) => list.filter((x) => x.key !== key));
      } else {
        const message = uploadErrorMessage(result);
        onToast(message, "error");
        onProgress((list) => list.map((x) => (x.key === key ? { ...x, error: message } : x)));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "The upload failed.";
      onToast(message, "error");
      onProgress((list) => list.map((x) => (x.key === key ? { ...x, error: message } : x)));
    }
  }
  return stored;
}

/** Does this drag carry files from the computer (and not, for example, a dragged playlist row)? */
export function dragHasFiles(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}
