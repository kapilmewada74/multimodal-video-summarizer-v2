// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_NUDGE, WEEK_MS, NUDGE_KEY, canShowNudge, loadNudgeState, recordDismissal, saveNudgeState } from "../nudge";

describe("when to ask a guest to sign in", () => {
  const now = 1_800_000_000_000;

  it("shows the first time", () => {
    expect(canShowNudge(EMPTY_NUDGE, now)).toBe(true);
  });

  it("comes back on the next visit, even the same day, after the first dismissal", () => {
    const state = recordDismissal(EMPTY_NUDGE, now);
    expect(canShowNudge(state, now + 60_000)).toBe(true);
  });

  it("waits a week after the second dismissal", () => {
    const state = recordDismissal(recordDismissal(EMPTY_NUDGE, now), now);
    expect(canShowNudge(state, now + 60_000)).toBe(false);
    expect(canShowNudge(state, now + WEEK_MS - 1)).toBe(false);
    expect(canShowNudge(state, now + WEEK_MS)).toBe(true);
  });

  it("keeps a weekly pattern after that", () => {
    let state = EMPTY_NUDGE;
    for (let i = 0; i < 4; i++) state = recordDismissal(state, now);
    expect(canShowNudge(state, now + 6 * 24 * 60 * 60 * 1000)).toBe(false);
    expect(canShowNudge(state, now + WEEK_MS)).toBe(true);
  });

  it("counts every dismissal", () => {
    expect(recordDismissal(recordDismissal(EMPTY_NUDGE, 1), 2)).toEqual({ dismissals: 2, lastDismissedAt: 2 });
  });
});

describe("remembering it in the browser", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips", () => {
    saveNudgeState({ dismissals: 2, lastDismissedAt: 123 });
    expect(loadNudgeState()).toEqual({ dismissals: 2, lastDismissedAt: 123 });
  });

  it("treats missing or damaged storage as never dismissed", () => {
    expect(loadNudgeState()).toEqual(EMPTY_NUDGE);
    localStorage.setItem(NUDGE_KEY, "{not json");
    expect(loadNudgeState()).toEqual(EMPTY_NUDGE);
    localStorage.setItem(NUDGE_KEY, JSON.stringify({ dismissals: "many" }));
    expect(loadNudgeState()).toEqual(EMPTY_NUDGE);
  });
});
