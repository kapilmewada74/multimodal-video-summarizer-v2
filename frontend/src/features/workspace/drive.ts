import { apiFetch, readError } from "../../lib/api";

/** Lets the app create files in the user's Drive, and nothing else in it. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const PENDING_KEY = "drive-export-pending";

/** Remember that a Drive save was waiting while the user is sent to Google to allow it. */
export function rememberPendingDrive(videoId: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, videoId);
  } catch {
    /* no storage: the user just presses the button again */
  }
}

/** True once if this video's Drive save was waiting for the user to come back from Google. */
export function takePendingDrive(videoId: string): boolean {
  try {
    if (sessionStorage.getItem(PENDING_KEY) !== videoId) return false;
    sessionStorage.removeItem(PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}

export type DriveResult =
  | { ok: true; url: string; name: string }
  | { ok: false; needsConsent: boolean; message: string };

/** Sends the study pack to Google Drive using the user's Google token (used once, never stored by us). */
export async function saveToDrive(videoId: string, googleToken: string): Promise<DriveResult> {
  const res = await apiFetch(`/api/videos/${videoId}/export/drive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: googleToken }),
  });
  if (res.ok) {
    const data = await res.json();
    return { ok: true, url: data.url, name: data.name };
  }
  let code = "";
  try {
    code = (await res.clone().json()).code ?? "";
  } catch {
    /* not JSON */
  }
  return { ok: false, needsConsent: code === "drive_auth", message: await readError(res, "Could not save to Google Drive.") };
}
