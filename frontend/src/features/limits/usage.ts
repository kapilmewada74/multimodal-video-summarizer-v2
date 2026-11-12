export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  resets_at: string;
}

export function formatUsage(usage: Usage): string {
  return `${usage.used} of ${usage.limit} videos today`;
}

export function formatReset(resetsAt: string, now: Date = new Date()): string {
  const ms = new Date(resetsAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "Resets soon";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `Resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Resets in ${hours} h ${minutes % 60} min`;
}
