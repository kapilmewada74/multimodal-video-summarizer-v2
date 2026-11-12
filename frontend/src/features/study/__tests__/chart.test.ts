import { describe, expect, it } from "vitest";
import type { StudyDay } from "../../../lib/types";
import { buildChartBars, goalLabel, minutesLeftForStreak } from "../chart";

const day = (d: string, seconds: number): StudyDay => ({ day: d, seconds, videos_done: 0, quizzes_taken: 0 });

describe("study chart", () => {
  it("scales bars to the biggest of the streak minimum, the goal and the best day", () => {
    const bars = buildChartBars([day("2026-11-08", 300), day("2026-11-09", 1200), day("2026-11-10", 0)], 600, 30);
    expect(bars.map((b) => b.heightPct)).toEqual([17, 67, 0]); // scale is the 30 minute goal (1800 s)
    expect(bars.map((b) => b.minutes)).toEqual([5, 20, 0]);
  });

  it("marks the days that count toward the streak and today", () => {
    const bars = buildChartBars([day("2026-11-08", 599), day("2026-11-09", 600), day("2026-11-10", 100)], 600, null);
    expect(bars.map((b) => b.counted)).toEqual([false, true, false]);
    expect(bars.map((b) => b.isToday)).toEqual([false, false, true]);
  });

  it("gives tiny but non-zero study a visible bar and keeps empty days empty", () => {
    const bars = buildChartBars([day("2026-11-09", 5), day("2026-11-10", 0)], 600, 600);
    expect(bars[0].heightPct).toBeGreaterThanOrEqual(4);
    expect(bars[1].heightPct).toBe(0);
  });

  it("handles an empty list and bad dates", () => {
    expect(buildChartBars([], 600, null)).toEqual([]);
    expect(buildChartBars([day("not a date", 60)], 600, null)[0].label).toBe("");
  });

  it("says how many minutes are left to keep the streak", () => {
    expect(minutesLeftForStreak(0, 600)).toBe(10);
    expect(minutesLeftForStreak(61, 600)).toBe(9);
    expect(minutesLeftForStreak(600, 600)).toBe(0);
    expect(minutesLeftForStreak(5000, 600)).toBe(0);
  });

  it("words the goals", () => {
    expect(goalLabel("minutes", 1)).toBe("Study 1 minute");
    expect(goalLabel("minutes", 30)).toBe("Study 30 minutes");
    expect(goalLabel("videos", 1)).toBe("Finish 1 video");
    expect(goalLabel("videos", 3)).toBe("Finish 3 videos");
    expect(goalLabel("quizzes", 1)).toBe("Take 1 quiz");
    expect(goalLabel("quizzes", 2)).toBe("Take 2 quizzes");
  });
});
