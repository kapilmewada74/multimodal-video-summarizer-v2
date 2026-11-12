import type { StudyDay } from "../../lib/types";

export interface ChartBar {
  day: string;
  label: string;
  minutes: number;
  heightPct: number;
  counted: boolean;   // enough study to count toward the streak
  isToday: boolean;
}

/** Bars for the last days of study. The tallest bar is the biggest of: the goal, the minimum for a streak day, or any day's study. */
export function buildChartBars(days: StudyDay[], streakMinSeconds: number, goalMinutes: number | null): ChartBar[] {
  const scale = Math.max(streakMinSeconds, (goalMinutes ?? 0) * 60, ...days.map((d) => d.seconds), 1);
  return days.map((d, index) => {
    const date = new Date(`${d.day}T12:00:00`);
    return {
      day: d.day,
      label: Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
      minutes: Math.floor(d.seconds / 60),
      heightPct: d.seconds > 0 ? Math.max(4, Math.round((d.seconds / scale) * 100)) : 0,
      counted: d.seconds >= streakMinSeconds,
      isToday: index === days.length - 1,
    };
  });
}

export function minutesLeftForStreak(todaySeconds: number, streakMinSeconds: number): number {
  return Math.max(0, Math.ceil((streakMinSeconds - todaySeconds) / 60));
}

export function goalLabel(type: "minutes" | "videos" | "quizzes", target: number): string {
  if (type === "minutes") return `Study ${target} minute${target === 1 ? "" : "s"}`;
  if (type === "videos") return `Finish ${target} video${target === 1 ? "" : "s"}`;
  return `Take ${target} quiz${target === 1 ? "" : "zes"}`;
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface HeatCell {
  day: string;
  minutes: number;
  level: HeatLevel;
  isToday: boolean;
  /** Days after today in the last column: drawn empty. */
  future: boolean;
}

/** 0 none, 1 a little, 2 enough for a streak day, 3 twice that, 4 four times that. */
export function heatLevel(seconds: number, streakMinSeconds: number): HeatLevel {
  if (seconds <= 0) return 0;
  if (seconds < streakMinSeconds) return 1;
  if (seconds < streakMinSeconds * 2) return 2;
  if (seconds < streakMinSeconds * 4) return 3;
  return 4;
}

const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A calendar grid of the last `weeks` weeks: one column per week (Monday first), one row per weekday,
 * ending with the current week. `days` are the days from the server (ending today); missing days count as 0.
 */
export function buildHeatmap(days: StudyDay[], streakMinSeconds: number, weeks = 12): HeatCell[][] {
  if (days.length === 0) return [];
  const bySecond = new Map(days.map((d) => [d.day, d.seconds]));
  const today = new Date(`${days[days.length - 1].day}T12:00:00`);
  const mondayOffset = (today.getDay() + 6) % 7;                 // Monday = 0
  const start = new Date(today);
  start.setDate(today.getDate() - mondayOffset - (weeks - 1) * 7);
  const columns: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: HeatCell[] = [];
    for (let r = 0; r < 7; r++) {
      const cell = new Date(start);
      cell.setDate(start.getDate() + w * 7 + r);
      const key = isoDate(cell);
      const future = cell.getTime() > today.getTime() && key !== days[days.length - 1].day;
      const seconds = bySecond.get(key) ?? 0;
      column.push({ day: key, minutes: Math.floor(seconds / 60), level: future ? 0 : heatLevel(seconds, streakMinSeconds), isToday: key === days[days.length - 1].day, future });
    }
    columns.push(column);
  }
  return columns;
}

/** "1 h 5 min", "42 min", "30 s": for session lists. */
export function formatStudyTime(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Totals for the last `days` of study: time, days that counted, best day, and the average on days studied. */
export function summarizeDays(days: StudyDay[], streakMinSeconds: number) {
  const total = days.reduce((n, d) => n + d.seconds, 0);
  const studied = days.filter((d) => d.seconds > 0);
  const best = days.reduce<StudyDay | null>((b, d) => (d.seconds > (b?.seconds ?? 0) ? d : b), null);
  return {
    totalSeconds: total,
    daysStudied: studied.length,
    daysCounted: days.filter((d) => d.seconds >= streakMinSeconds).length,
    averageSeconds: studied.length ? Math.round(total / studied.length) : 0,
    bestDay: best && best.seconds > 0 ? best : null,
    pomodoros: days.reduce((n, d) => n + (d.pomodoros ?? 0), 0),
  };
}
