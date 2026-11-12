/** The sound and the notification when a Pomodoro phase ends. Both are optional and fail quietly. */

let audio: AudioContext | null = null;

/** A short two-tone chime made in the browser (no sound file). Must follow a click or key press to be allowed. */
export function playChime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio = audio ?? new Ctx();
    void audio.resume?.();
    const now = audio.currentTime;
    [[660, 0], [880, 0.22]].forEach(([freq, offset]) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5);
      osc.connect(gain).connect(audio!.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.55);
    });
  } catch {
    /* no sound is fine */
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Ask once, when the user starts a timer. Returns whether we may show notifications. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function showNotification(title: string, body: string): void {
  try {
    if (notificationsSupported() && Notification.permission === "granted") new Notification(title, { body, tag: "pomodoro" });
  } catch {
    /* some mobile browsers only allow this from a service worker: skip */
  }
}
