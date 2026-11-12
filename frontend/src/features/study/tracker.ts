import type { StudySummary } from "../../lib/types";

export interface StudyApi {
  start(videoId: string | null): Promise<string>;
  heartbeat(sessionId: string, active: boolean): Promise<StudySummary | "gone">;
  end(sessionId: string): Promise<void>;
}

export interface TrackerOptions {
  api: StudyApi;
  /** Is the person studying right now? */
  getActive: () => boolean;
  onSummary: (summary: StudySummary) => void;
  intervalMs?: number;
  /** Called every second with the seconds of study in this session (for the on-screen timer). */
  onSessionSeconds?: (seconds: number) => void;
}

/** One study session: starts it, sends a heartbeat every ~20 s, and ends it. */
export class StudyTracker {
  private sessionId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private seconds = 0;
  private stopped = false;
  private busy = false;

  constructor(private options: TrackerOptions) {}

  async start(videoId: string | null): Promise<void> {
    this.stopped = false;
    this.sessionId = await this.options.api.start(videoId);
    if (this.stopped) {
      // stop() was called while the session was starting
      void this.options.api.end(this.sessionId).catch(() => undefined);
      return;
    }
    this.clockTimer = setInterval(() => {
      if (this.options.getActive()) {
        this.seconds += 1;
        this.options.onSessionSeconds?.(this.seconds);
      }
    }, 1000);
    this.heartbeatTimer = setInterval(() => void this.beat(videoId), this.options.intervalMs ?? 20_000);
  }

  private async beat(videoId: string | null): Promise<void> {
    if (this.busy || !this.sessionId || this.stopped) return;
    this.busy = true;
    try {
      let result = await this.options.api.heartbeat(this.sessionId, this.options.getActive());
      if (result === "gone" && !this.stopped) {
        // The server no longer knows this session (for example it was ended): begin a new one.
        this.sessionId = await this.options.api.start(videoId);
        result = await this.options.api.heartbeat(this.sessionId, this.options.getActive());
      }
      if (result !== "gone") this.options.onSummary(result);
    } catch {
      // A failed heartbeat (offline, server busy) is simply tried again at the next tick.
    } finally {
      this.busy = false;
    }
  }

  /** Send one heartbeat now (for example when the video is paused) without waiting for the timer. */
  flush(videoId: string | null): Promise<void> {
    return this.beat(videoId);
  }

  stop(): Promise<void> {
    this.stopped = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.heartbeatTimer = this.clockTimer = null;
    const id = this.sessionId;
    this.sessionId = null;
    return id ? this.options.api.end(id).catch(() => undefined) : Promise.resolve();
  }

  getSessionSeconds(): number {
    return this.seconds;
  }

  /** The server's id for this session (null until it has started). */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Start the on-screen timer from zero again. The time already credited to the account is not touched. */
  resetSeconds(): void {
    this.seconds = 0;
    this.options.onSessionSeconds?.(0);
  }
}
