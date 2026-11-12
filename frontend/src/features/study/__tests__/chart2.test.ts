import { describe, expect, it } from "vitest";
import type { StudyDay } from "../../../lib/types";
import { buildHeatmap, formatStudyTime, heatLevel, summarizeDays } from "../chart";

const day = (d: string, seconds: number, extra: Partial<StudyDay> = {}): StudyDay => ({ day: d, seconds, videos_done: 0, quizzes_taken: 0, ...extra });
const MIN = 600;

describe("heatLevel", () => {
  it("steps up with how much was studied compared with a streak day", () => {
    expect([0, 1, 599, 600, 1199, 1200, 2399, 2400, 99999].map((s) => heatLevel(s, MIN))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("buildHeatmap", () => {
  // Wed 11 Nov 2026 is "today"; the last week runs Mon 9 to Sun 15.
  const days = [day("2026-11-07", 700), day("2026-11-08", 100), day("2026-11-09", 3000), day("2026-11-10", 0), day("2026-11-11", 1300)];

  it("has one column per week, Monday first, ending with the current week", () => {
    const grid = buildHeatmap(days, MIN, 3);
    expect(grid).toHaveLength(3);
    expect(grid.every((col) => col.length === 7)).toBe(true);
    expect(grid[2][0].day).toBe("2026-11-09");          // Monday of this week
    expect(grid[2][6].day).toBe("2026-11-15");
    expect(grid[0][0].day).toBe("2026-10-26");
  });

  it("marks today and the days still to come", () => {
    const week = buildHeatmap(days, MIN, 2)[1];
    expect(week.map((c) => c.isToday)).toEqual([false, false, true, false, false, false, false]);
    expect(week.map((c) => c.future)).toEqual([false, false, false, true, true, true, true]);
    expect(week.filter((c) => c.future).every((c) => c.level === 0)).toBe(true);
  });

  it("colours each day by how much was studied and treats missing days as none", () => {
    const grid = buildHeatmap(days, MIN, 2);
    const cell = (iso: string) => grid.flat().find((c) => c.day === iso)!;
    expect(cell("2026-11-07").level).toBe(2);           // 700 s: a streak day
    expect(cell("2026-11-08").level).toBe(1);           // 100 s: a little
    expect(cell("2026-11-09").level).toBe(4);           // 3000 s: five times a streak day
    expect(cell("2026-11-10").level).toBe(0);
    expect(cell("2026-11-11").level).toBe(3);           // 1300 s
    expect(cell("2026-11-02").level).toBe(0);           // before the data: nothing
    expect(cell("2026-11-09").minutes).toBe(50);
  });

  it("copes with no data", () => {
    expect(buildHeatmap([], MIN)).toEqual([]);
  });
});

describe("formatStudyTime", () => {
  it("reads naturally at every size", () => {
    expect([0, 29, 59, 60, 89, 3540, 3600, 3660, 7200, 9000].map(formatStudyTime)).toEqual(["0 s", "29 s", "59 s", "1 min", "1 min", "59 min", "1 h", "1 h 1 min", "2 h", "2 h 30 min"]);
    expect(formatStudyTime(-5)).toBe("0 s");
  });
});

describe("summarizeDays", () => {
  it("adds up time, days studied and counted, the best day, the average and pomodoros", () => {
    const s = summarizeDays([day("a", 600, { pomodoros: 2 }), day("b", 0), day("c", 1800, { pomodoros: 1 }), day("d", 300)], MIN);
    expect(s).toMatchObject({ totalSeconds: 2700, daysStudied: 3, daysCounted: 2, averageSeconds: 900, pomodoros: 3 });
    expect(s.bestDay?.day).toBe("c");
  });

  it("has no best day when nothing was studied", () => {
    expect(summarizeDays([day("a", 0)], MIN)).toMatchObject({ totalSeconds: 0, daysStudied: 0, averageSeconds: 0, bestDay: null });
    expect(summarizeDays([], MIN).bestDay).toBeNull();
  });
});
