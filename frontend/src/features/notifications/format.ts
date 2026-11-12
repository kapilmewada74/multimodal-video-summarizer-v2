export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const KIND_LABELS = {
  goal_reached: { title: "Daily goal reached", hint: "When you reach one of your daily goals" },
  streak_at_risk: { title: "Streak reminder", hint: "In the evening, if today's study would otherwise end your streak" },
  streak_milestone: { title: "Streak milestones", hint: "When you reach 3, 7, 14, 30 days in a row and more" },
  summary_ready: { title: "Summary ready", hint: "When a video you added has finished processing" },
} as const;

export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${suffix}`;
}
