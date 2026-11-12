/** Helpers and the controller for the YouTube player. Kept free of React so they can be tested. */

/** The 11-character video id from a YouTube link, or null. Mirrors the server's check. */
export function extractYouTubeId(input: string | null | undefined): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  const patterns = [
    /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?(?:[^&#]*&)*v=([\w-]{11})(?:[&#].*)?$/,
    /^(?:https?:\/\/)?(?:www\.)?youtu\.be\/([\w-]{11})(?:[?&#].*)?$/,
    /^(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:shorts|live|embed)\/([\w-]{11})(?:[?&#].*)?$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

/** Where to start: resume a partly watched video, but not one that is (nearly) finished. */
export function resumePosition(progressSeconds: number, durationSeconds: number, completed: boolean): number {
  if (completed || progressSeconds < 5) return 0;
  if (durationSeconds > 0 && progressSeconds >= durationSeconds - 5) return 0;
  return Math.floor(progressSeconds);
}

// ---- the minimal part of YouTube's IFrame API that we use -------------------------------------
export interface YTPlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YTNamespace {
  Player: new (element: HTMLElement | string, options: Record<string, unknown>) => YTPlayerLike;
  PlayerState: { UNSTARTED: number; ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads YouTube's IFrame API once and resolves with it. */
export function loadYouTubeApi(win: Window = window, doc: Document = document): Promise<YTNamespace> {
  if (win.YT?.Player) return Promise.resolve(win.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (win.YT?.Player) resolve(win.YT);
      else reject(new Error("YouTube player failed to initialise."));
    };
    const script = doc.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiPromise = null; // allow a retry later
      reject(new Error("Could not load the YouTube player. Check your connection."));
    };
    doc.head.appendChild(script);
  });
  return apiPromise;
}

/** Test helper: forget the loaded API. */
export function resetYouTubeApiForTests(): void {
  apiPromise = null;
}

export interface PlayerSnapshot {
  playing: boolean;
  ended: boolean;
  position: number;
  duration: number;
  muted: boolean;
  rate: number;
  ready: boolean;
}

export interface ControllerOptions {
  videoId: string;
  startSeconds?: number;
  autoplay?: boolean;
  origin?: string;
  pollMs?: number;
}

export interface ControllerCallbacks {
  onUpdate: (snapshot: PlayerSnapshot) => void;
  onError?: (code: number) => void;
}

/** Wraps YT.Player: our own play/seek/speed controls and a steady stream of snapshots. */
export class PlayerController {
  private player: YTPlayerLike | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshot: PlayerSnapshot = { playing: false, ended: false, position: 0, duration: 0, muted: false, rate: 1, ready: false };
  private destroyed = false;

  constructor(private yt: YTNamespace, element: HTMLElement, private options: ControllerOptions, private callbacks: ControllerCallbacks) {
    this.player = new yt.Player(element, {
      videoId: options.videoId,
      playerVars: {
        controls: 0, // we draw our own controls
        rel: 0, modestbranding: 1, playsinline: 1, disablekb: 1, fs: 0, iv_load_policy: 3,
        autoplay: options.autoplay ? 1 : 0,
        start: Math.max(0, Math.floor(options.startSeconds ?? 0)),
        origin: options.origin,
      },
      events: {
        onReady: () => this.handleReady(),
        onStateChange: (event: { data: number }) => this.handleState(event.data),
        onError: (event: { data: number }) => this.callbacks.onError?.(event.data),
      },
    });
  }

  private handleReady(): void {
    if (this.destroyed || !this.player) return;
    this.snapshot = { ...this.snapshot, ready: true, duration: this.safeDuration() };
    this.timer = setInterval(() => this.poll(), this.options.pollMs ?? 500);
    this.emit();
  }

  private handleState(state: number): void {
    const S = this.yt.PlayerState;
    this.snapshot = { ...this.snapshot, playing: state === S.PLAYING || state === S.BUFFERING, ended: state === S.ENDED };
    this.poll();
  }

  private safeDuration(): number {
    const d = this.player?.getDuration() ?? 0;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  private poll(): void {
    if (this.destroyed || !this.player) return;
    const position = this.player.getCurrentTime();
    this.snapshot = {
      ...this.snapshot,
      position: Number.isFinite(position) ? position : this.snapshot.position,
      duration: this.safeDuration() || this.snapshot.duration,
      muted: this.player.isMuted(),
    };
    this.emit();
  }

  private emit(): void {
    this.callbacks.onUpdate({ ...this.snapshot });
  }

  play(): void { this.player?.playVideo(); }
  pause(): void { this.player?.pauseVideo(); }
  toggle(): void { (this.snapshot.playing ? this.pause() : this.play()); }

  seek(seconds: number): void {
    const max = this.snapshot.duration || Number.MAX_SAFE_INTEGER;
    this.player?.seekTo(Math.min(Math.max(0, seconds), max), true);
    this.poll();
  }

  skip(delta: number): void { this.seek(this.snapshot.position + delta); }

  setRate(rate: number): void {
    this.player?.setPlaybackRate(rate);
    this.snapshot = { ...this.snapshot, rate };
    this.emit();
  }

  setMuted(muted: boolean): void {
    if (muted) this.player?.mute(); else this.player?.unMute();
    this.snapshot = { ...this.snapshot, muted };
    this.emit();
  }

  getSnapshot(): PlayerSnapshot { return { ...this.snapshot }; }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { this.player?.destroy(); } catch { /* already gone */ }
    this.player = null;
  }
}

/**
 * Decides when to save the viewing position: at most every `intervalMs` while playing, and
 * at once when the video is paused or ends, but never for an unchanged position.
 */
export class ProgressThrottle {
  private lastAt = -Infinity;
  private lastPosition = -1;
  private wasPlaying = false;

  constructor(private intervalMs = 10_000) {}

  /** Returns the position to save now, or null. */
  next(now: number, position: number, playing: boolean, ended: boolean): number | null {
    const stoppedNow = this.wasPlaying && !playing;
    this.wasPlaying = playing;
    const whole = Math.floor(position);
    if (whole <= 0 || whole === this.lastPosition) return null;
    const due = playing && now - this.lastAt >= this.intervalMs;
    if (due || stoppedNow || ended) {
      this.lastAt = now;
      this.lastPosition = whole;
      return whole;
    }
    return null;
  }
}
