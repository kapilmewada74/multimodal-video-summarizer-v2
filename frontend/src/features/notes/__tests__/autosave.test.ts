// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type SaveStatus } from "../autosave";

describe("Autosaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(save = vi.fn(async () => undefined)) {
    const statuses: SaveStatus[] = [];
    const saver = new Autosaver({ save, onStatus: (s) => statuses.push(s), delayMs: 1000 });
    saver.setBaseline("start");
    return { saver, save, statuses };
  }

  it("saves a moment after typing stops, not on every keystroke", async () => {
    const { saver, save, statuses } = setup();
    saver.change("a");
    saver.change("ab");
    saver.change("abc");
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abc");
    expect(statuses).toEqual(["dirty", "dirty", "dirty", "saving", "saved"]);
  });

  it("does nothing when the text is back to what is saved", async () => {
    const { saver, save, statuses } = setup();
    saver.change("changed");
    saver.change("start");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("saved");
  });

  it("flush saves immediately (for example when leaving the page)", async () => {
    const { saver, save } = setup();
    saver.change("quick edit");
    await saver.flush();
    expect(save).toHaveBeenCalledWith("quick edit");
  });

  it("never loses an edit made while a save is running", async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { saver, statuses } = setup(save);
    saver.change("first");
    await vi.advanceTimersByTimeAsync(1000); // first save starts and waits
    saver.change("second");                  // typed during the save
    finish();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("second");
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("never runs two saves at the same time", async () => {
    let running = 0, maxRunning = 0;
    const save = vi.fn(async () => {
      running += 1; maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 500));
      running -= 1;
    });
    const { saver } = setup(save);
    saver.change("a");
    const first = saver.flush();
    saver.change("b");
    const second = saver.flush();
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all([first, second]);
    expect(maxRunning).toBe(1);
    expect(save).toHaveBeenLastCalledWith("b");
  });

  it("keeps the text and reports an error when saving fails, then recovers", async () => {
    let fail = true;
    const save = vi.fn(async () => { if (fail) throw new Error("offline"); });
    const { saver, statuses } = setup(save);
    saver.change("important");
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.at(-1)).toBe("error");
    fail = false;
    saver.change("important!");
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenLastCalledWith("important!");
    expect(statuses.at(-1)).toBe("saved");
  });

  it("dispose cancels a pending save", async () => {
    const { saver, save } = setup();
    saver.change("x");
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});
