import type { VideoSummary } from "../../lib/types";

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function statusLabel(status: VideoSummary["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    case "processing":
      return "Processing";
    default:
      return "Queued";
  }
}

export function displayTitle(video: Pick<VideoSummary, "title" | "status">): string {
  if (video.title) return video.title;
  return video.status === "failed" ? "Video could not be processed" : "Processing video…";
}

export function formatAdded(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
