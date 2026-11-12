import { getAuthToken } from "./api";

export interface UploadResult {
  status: number;
  body: unknown;
}

/**
 * Upload a form with a progress callback (fetch cannot report upload progress). Sends the sign-in token.
 * `signal` cancels the upload. Rejects only on network errors and cancellation; HTTP errors resolve
 * with their status so the caller can show the server's message.
 */
export async function uploadWithProgress(
  url: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const token = await getAuthToken();
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      onProgress(1);
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("The upload could not be completed. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** A readable message from an upload response. */
export function uploadErrorMessage(result: UploadResult, fallback = "The upload failed. Please try again."): string {
  const body = result.body as { message?: unknown; detail?: unknown } | null;
  if (body && typeof body.message === "string" && body.message) return body.message;
  if (body && typeof body.detail === "string" && body.detail) return body.detail;
  if (result.status === 413) return "That file is too large.";
  if (result.status === 401) return "Please sign in again and retry.";
  return fallback;
}
