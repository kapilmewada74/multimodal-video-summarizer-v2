export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaverOptions {
  save: (text: string) => Promise<void>;
  onStatus: (status: SaveStatus) => void;
  delayMs?: number;
}

/** Saves text a moment after the user stops typing, never two saves at once, and never loses the last edit. */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latest = "";
  private lastSaved: string | null = null;
  private saving = false;
  private pending = false;

  constructor(private options: AutosaverOptions) {}

  /** The text as loaded from the server (nothing to save yet). */
  setBaseline(text: string): void {
    this.latest = text;
    this.lastSaved = text;
  }

  change(text: string): void {
    this.latest = text;
    if (text === this.lastSaved) {
      this.clearTimer();
      this.options.onStatus("saved");
      return;
    }
    this.options.onStatus("dirty");
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.options.delayMs ?? 1200);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (this.saving) {
      this.pending = true; // save again as soon as the current save finishes
      return;
    }
    if (this.latest === this.lastSaved) return;
    this.saving = true;
    const text = this.latest;
    this.options.onStatus("saving");
    try {
      await this.options.save(text);
      this.lastSaved = text;
      this.options.onStatus(this.latest === text ? "saved" : "dirty");
    } catch {
      this.options.onStatus("error");
      // keep the text; try again after the next edit or a manual flush
    } finally {
      this.saving = false;
      if (this.pending || (this.latest !== this.lastSaved && this.timer === null)) {
        this.pending = false;
        if (this.latest !== this.lastSaved) this.timer = setTimeout(() => void this.flush(), this.options.delayMs ?? 1200);
      }
    }
  }

  dispose(): void {
    this.clearTimer();
  }
}
