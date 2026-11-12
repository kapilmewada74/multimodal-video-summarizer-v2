import { apiFetch } from "../../lib/api";
import type { StudySummary } from "../../lib/types";
import type { StudyApi } from "./tracker";

/** The study-session calls to our server. */
export const httpStudyApi: StudyApi = {
  async start(videoId) {
    const res = await apiFetch("/api/study/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(videoId ? { video_id: videoId } : {}),
    });
    if (!res.ok) throw new Error("Could not start a study session.");
    return (await res.json()).id as string;
  },
  async heartbeat(sessionId, active) {
    const res = await apiFetch(`/api/study/sessions/${sessionId}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (res.status === 404) return "gone";
    if (!res.ok) throw new Error("Heartbeat failed.");
    return (await res.json()) as StudySummary;
  },
  async end(sessionId) {
    // keepalive lets the request finish even while the page is closing.
    await apiFetch(`/api/study/sessions/${sessionId}/end`, { method: "POST", keepalive: true });
  },
};

/** A focus block finished. Returns whether the server counted it (it ignores repeats and runaway counts). */
export async function recordPomodoro(sessionId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/study/sessions/${sessionId}/pomodoro`, { method: "POST" });
    return res.ok ? Boolean((await res.json()).counted) : false;
  } catch {
    return false;
  }
}
