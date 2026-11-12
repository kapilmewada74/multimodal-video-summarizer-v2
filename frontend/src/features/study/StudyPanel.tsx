"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, EllipsisVertical, Flame, Pause, Play, RotateCcw, Settings2, Snowflake, Target, Timer, TimerReset } from "lucide-react";
import { ActionMenu, type MenuItem } from "../../components/ui/ActionMenu";
import { formatClock } from "../player/youtube";
import { PomodoroCard } from "./PomodoroCard";
import { PHASE_LABEL, formatCountdown } from "./pomodoro";
import type { StudyTools } from "./useStudyTools";

const GOAL_CHOICES = [15, 30, 45, 60, 90];

/**
 * The study bar under the video: this visit's timer, today's progress and the streak, with a menu (the three dots)
 * for the focus timer, pausing, a goal for this visit, and the stats page.
 */
export function StudyPanel({ tools }: { tools: StudyTools }) {
  const router = useRouter();
  const { summary, sessionSeconds, paused, goalMin, pomodoro, onBreak } = tools;
  const [panel, setPanel] = useState<"timer" | "settings" | "goal" | null>(null);

  const minutesGoal = summary?.goals.find((g) => g.type === "minutes" && g.active);
  const todayMinutes = Math.floor((summary?.today.seconds ?? 0) / 60);
  const percent = minutesGoal ? Math.min(100, Math.round(((summary?.today.seconds ?? 0) / 60 / minutesGoal.target) * 100)) : null;
  const streak = summary?.streak;
  const sessionPercent = goalMin ? Math.min(100, Math.round((sessionSeconds / 60 / goalMin) * 100)) : null;
  const timerActive = pomodoro.running || !pomodoro.idle;

  const items: MenuItem[] = [
    {
      key: "timer", label: panel === "timer" || panel === "settings" ? "Hide the focus timer" : "Focus timer (Pomodoro)",
      hint: "25 minutes of focus, then a break", icon: <Timer className="h-4 w-4" />, onSelect: () => setPanel((p) => (p === "timer" || p === "settings" ? null : "timer")),
    },
    {
      key: "settings", label: "Timer lengths and sounds", hint: "Presets or your own", icon: <Settings2 className="h-4 w-4" />, onSelect: () => setPanel("settings"),
    },
    {
      key: "pause", label: paused ? "Resume tracking" : "Pause tracking", hint: paused ? "Start counting study time again" : "Nothing is counted while paused",
      icon: paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />, onSelect: tools.togglePaused, separated: true,
    },
    { key: "goal", label: goalMin ? "Change the goal for this visit" : "Set a goal for this visit", hint: goalMin ? `Now ${goalMin} minutes` : "For example 30 minutes", icon: <Target className="h-4 w-4" />, onSelect: () => setPanel("goal") },
    { key: "reset", label: "Restart this visit's timer", hint: "Your saved study time is not changed", icon: <TimerReset className="h-4 w-4" />, onSelect: tools.resetSession },
    { key: "stats", label: "Stats, streak and goals", icon: <BarChart3 className="h-4 w-4" />, onSelect: () => router.push("/study"), separated: true },
  ];

  return (
    <section aria-label="Study session" className="mt-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-xs font-bold text-[var(--text-main)]">
        <span className="inline-flex items-center gap-1.5" title="Time studied in this visit">
          <Timer className="h-4 w-4" /> <span className="tabular-nums">{formatClock(sessionSeconds)}</span>
          {paused && <span role="status" className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">Paused</span>}
          {!paused && onBreak && <span role="status" className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">Break: not counted</span>}
        </span>

        <Link href="/study" className="inline-flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-main)]" aria-label="Today's progress. Open the study page.">
          <span>{minutesGoal ? `${todayMinutes} / ${minutesGoal.target} min today` : `${todayMinutes} min today`}</span>
          {percent !== null && (
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-label="Daily minutes goal" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-full rounded-full bg-[var(--brand-lime)]" style={{ width: `${percent}%` }} />
            </span>
          )}
        </Link>

        {streak && streak.current > 0 && (
          <span className={`inline-flex items-center gap-1 ${streak.at_risk ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`} title={streak.at_risk ? "Study today to keep your streak" : "Days in a row"}>
            <Flame className="h-4 w-4" /> {streak.current}-day streak
            {streak.freeze_available && <Snowflake className="h-3.5 w-3.5 text-sky-500" aria-label="One missed day is forgiven this week" />}
          </span>
        )}

        {sessionPercent !== null && (
          <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
            Visit goal {goalMin} min
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]" role="progressbar" aria-label="Goal for this visit" aria-valuenow={sessionPercent} aria-valuemin={0} aria-valuemax={100}>
              <span className="block h-full rounded-full bg-sky-400" style={{ width: `${sessionPercent}%` }} />
            </span>
          </span>
        )}

        <span className="ml-auto flex items-center gap-2">
          {timerActive && panel === null && (
            <button
              type="button" onClick={() => setPanel("timer")} aria-label={`Focus timer: ${PHASE_LABEL[pomodoro.phase]}, ${formatCountdown(pomodoro.remaining)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 tabular-nums cursor-pointer"
            >
              {pomodoro.running ? <Play className="h-3 w-3 fill-current" /> : <Pause className="h-3 w-3" />}
              {formatCountdown(pomodoro.remaining)} <span className="font-normal text-[var(--text-muted)]">{PHASE_LABEL[pomodoro.phase]}</span>
            </button>
          )}
          <ActionMenu label="Study session options" icon={<EllipsisVertical className="h-4 w-4" />} items={items} width="w-72" heading="This study visit" />
        </span>
      </div>

      {(panel === "timer" || panel === "settings") && (
        <PomodoroCard timer={pomodoro} todayPomodoros={Math.max(summary?.today.pomodoros ?? 0, tools.pomodorosThisVisit)} onClose={() => setPanel(null)} showSettings={panel === "settings"} />
      )}

      {panel === "goal" && (
        <div className="border-t border-[var(--card-border)] px-4 py-3" role="group" aria-label="Goal for this visit">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black">Goal for this visit</h3>
            <button type="button" onClick={() => setPanel(null)} className="text-xs font-bold text-[var(--text-muted)] underline cursor-pointer">Close</button>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">How long do you want to study now? You get a message and a sound when you get there.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {GOAL_CHOICES.map((m) => (
              <button key={m} type="button" aria-pressed={goalMin === m} onClick={() => { tools.setGoal(m); setPanel(null); }}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer ${goalMin === m ? "border-transparent bg-[var(--brand-lime)] text-[#0E0F0C]" : "border-[var(--card-border)] bg-[var(--btn-secondary-bg)]"}`}>
                {m} min
              </button>
            ))}
            {goalMin !== null && (
              <button type="button" onClick={() => { tools.setGoal(null); setPanel(null); }} className="inline-flex items-center gap-1 text-xs font-bold text-[var(--text-muted)] underline cursor-pointer">
                <RotateCcw className="h-3 w-3" /> No goal
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
