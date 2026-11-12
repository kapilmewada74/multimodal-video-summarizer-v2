/**
 * Is the person really studying? Study time counts only while the tab is visible and
 * they are watching or have recently touched the page (typing notes counts).
 */
export const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

let lastActivity = 0;
let listening = false;

export function markActivity(now: number = Date.now()): void {
  lastActivity = now;
}

export function lastActivityAt(): number {
  return lastActivity;
}

export function isRecentlyActive(now: number = Date.now(), windowMs: number = ACTIVE_WINDOW_MS): boolean {
  return lastActivity > 0 && now - lastActivity <= windowMs;
}

/** Start listening to normal page interaction (idempotent). Returns a stop function. */
export function trackPageActivity(target: Window = window): () => void {
  if (listening) return () => undefined;
  listening = true;
  const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"] as const;
  const handler = () => markActivity();
  events.forEach((name) => target.addEventListener(name, handler, { passive: true }));
  markActivity();
  return () => {
    events.forEach((name) => target.removeEventListener(name, handler));
    listening = false;
  };
}

/** Counts as studying: the tab is visible AND (the video is playing OR the user was recently active). */
export function isStudying(playing: boolean, visible: boolean, now: number = Date.now()): boolean {
  return visible && (playing || isRecentlyActive(now));
}

export function resetActivityForTests(): void {
  lastActivity = 0;
  listening = false;
}
