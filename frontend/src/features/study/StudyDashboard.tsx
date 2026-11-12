"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Flame, Loader2, Snowflake, Target, Timer, Trophy } from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import type { GoalProgress, StudyOverview, StudySession, VideoStudyTime } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { buildChartBars, buildHeatmap, formatStudyTime, goalLabel, minutesLeftForStreak, summarizeDays } from "./chart";

const HEAT_COLORS = [
  "var(--btn-secondary-bg)",
  "color-mix(in srgb, var(--brand-lime) 30%, transparent)",
  "color-mix(in srgb, var(--brand-lime) 60%, transparent)",
  "color-mix(in srgb, var(--brand-lime) 85%, transparent)",
  "var(--brand-lime)",
];

type GoalType = GoalProgress["type"];
const GOAL_TYPES: { type: GoalType; label: string; unit: string; fallback: number; max: number }[] = [
  { type: "minutes", label: "Minutes studied", unit: "minutes", fallback: 30, max: 1440 },
  { type: "videos", label: "Videos finished", unit: "videos", fallback: 1, max: 100 },
  { type: "quizzes", label: "Quizzes taken", unit: "quizzes", fallback: 1, max: 100 },
];

type Draft = Record<GoalType, { enabled: boolean; target: number }>;

function draftFrom(goals: GoalProgress[]): Draft {
  const draft = {} as Draft;
  for (const g of GOAL_TYPES) {
    const existing = goals.find((x) => x.type === g.type);
    draft[g.type] = { enabled: existing ? existing.active : false, target: existing?.target ?? g.fallback };
  }
  return draft;
}

export function StudyDashboard({ onToast }: { onToast: (message: string, type?: "success" | "info" | "error") => void }) {
  const { ready, signedIn, configured } = useAuth();
  const [data, setData] = useState<StudyOverview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [byVideo, setByVideo] = useState<VideoStudyTime[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/study/overview?days=84");
      if (!res.ok) throw new Error(await readError(res, "Could not load your study stats."));
      const overview: StudyOverview = await res.json();
      setData(overview);
      setDraft((prev) => prev ?? draftFrom(overview.goals));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your study stats.");
    }
  }, []);

  useEffect(() => {
    if (!ready || !signedIn) return;
    void load();
    // The extras are nice to have: if they fail the rest of the page still works.
    apiFetch("/api/study/videos?days=30&limit=6").then((r) => (r.ok ? r.json() : null)).then((d) => d && setByVideo(d.items)).catch(() => undefined);
    apiFetch("/api/study/sessions?limit=8").then((r) => (r.ok ? r.json() : null)).then((d) => d && setSessions(d.items)).catch(() => undefined);
  }, [ready, signedIn, load]);

  const saveGoals = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const goals = GOAL_TYPES.filter((g) => draft[g.type].enabled || data?.goals.some((x) => x.type === g.type)).map((g) => ({
        type: g.type, target: Math.min(g.max, Math.max(1, Math.round(draft[g.type].target) || g.fallback)), active: draft[g.type].enabled,
      }));
      const res = await apiFetch("/api/study/goals", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goals }) });
      if (!res.ok) throw new Error(await readError(res, "Could not save your goals."));
      onToast("Goals saved.", "success");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not save your goals.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!configured) return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Sign-in is not configured for this app yet.</div>;
  if (error) return <div role="alert" className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-sm">{error}</div>;
  if (!data || !draft) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--text-muted)]" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const minutesGoal = data.goals.find((g) => g.type === "minutes" && g.active) ?? null;
  const bars = buildChartBars(data.days.slice(-14), data.streak.min_seconds, minutesGoal?.target ?? null);
  const heat = buildHeatmap(data.days, data.streak.min_seconds, 12);
  const month = summarizeDays(data.days.slice(-30), data.streak.min_seconds);
  const weekDays = data.week ?? [];
  const weekCounted = weekDays.filter((d) => d.counted).length;
  const topVideoSeconds = Math.max(1, ...byVideo.map((v) => v.seconds));
  const todayMinutes = Math.floor(data.today.seconds / 60);
  const left = minutesLeftForStreak(data.today.seconds, data.streak.min_seconds);
  const card = "rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 shadow-sm";

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-black tracking-tight">Your study</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className={card} aria-label="Today">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">Today</p>
          <p className="mt-2 text-3xl font-black tabular-nums">{todayMinutes}<span className="text-base font-bold text-[var(--text-muted)]"> min</span></p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{data.today.videos_done} video{data.today.videos_done === 1 ? "" : "s"} finished · {data.today.quizzes_taken} quiz{data.today.quizzes_taken === 1 ? "" : "zes"}</p>
          {(data.today.pomodoros ?? 0) > 0 && <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[var(--text-main)]"><Timer className="h-3.5 w-3.5" /> {data.today.pomodoros} focus block{data.today.pomodoros === 1 ? "" : "s"}</p>}
        </section>
        <section className={card} aria-label="Streak">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]"><Flame className="h-4 w-4 text-amber-500" /> Streak</p>
          <p className="mt-2 text-3xl font-black tabular-nums">{data.streak.current}<span className="text-base font-bold text-[var(--text-muted)]"> day{data.streak.current === 1 ? "" : "s"}</span></p>
          <p className={`mt-1 text-xs ${data.streak.at_risk ? "font-bold text-rose-600 dark:text-rose-400" : "text-[var(--text-muted)]"}`}>
            {data.streak.today_done
              ? "Today counts. Nice work!"
              : data.streak.at_risk
                ? `Your streak is at risk. Study ${left} minute${left === 1 ? "" : "s"} today to save it.`
                : `Study ${left} more minute${left === 1 ? "" : "s"} today to keep it going.`}
          </p>
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            <Snowflake className={`h-3.5 w-3.5 ${data.streak.freeze_available ? "text-sky-500" : "opacity-40"}`} />
            {data.streak.freeze_available ? "One missed day is forgiven this week." : "This week's forgiven day is used."}
          </p>
        </section>
        <section className={card} aria-label="Best streak">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]"><Trophy className="h-4 w-4 text-amber-500" /> Best streak</p>
          <p className="mt-2 text-3xl font-black tabular-nums">{data.streak.longest}<span className="text-base font-bold text-[var(--text-muted)]"> day{data.streak.longest === 1 ? "" : "s"}</span></p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">A day counts after {Math.round(data.streak.min_seconds / 60)} minutes of study.</p>
        </section>
      </div>

      {weekDays.length === 7 && (
        <section className={card} aria-label="This week">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-black">This week</h2>
            <p className="text-xs text-[var(--text-muted)]">{weekCounted} of 7 days counted</p>
          </div>
          <ol className="grid grid-cols-7 gap-1.5 sm:gap-3">
            {weekDays.map((d) => {
              const label = new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
              const state = d.counted ? "counted" : d.frozen ? "forgiven" : d.future ? "later" : d.is_today ? "today" : "missed";
              return (
                <li key={d.day} className="flex flex-col items-center gap-1.5" aria-label={`${label}: ${state}, ${Math.floor(d.seconds / 60)} minutes`}>
                  <span className="text-[11px] font-bold text-[var(--text-muted)]">{label.slice(0, 3)}</span>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-black sm:h-11 sm:w-11 ${
                      d.counted ? "border-transparent bg-[var(--brand-lime)] text-[#0E0F0C]"
                        : d.frozen ? "border-sky-400/60 bg-sky-400/15 text-sky-600"
                        : d.is_today ? "border-[var(--text-main)]/40 text-[var(--text-main)]"
                        : "border-[var(--card-border)] text-[var(--text-muted)] opacity-70"
                    } ${d.future ? "opacity-30" : ""}`}
                  >
                    {d.counted ? "✓" : d.frozen ? <Snowflake className="h-4 w-4" /> : d.future ? "" : Math.floor(d.seconds / 60) || ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section className={card} aria-label="Last 14 days">
        <h2 className="mb-4 text-sm font-black">Last 14 days</h2>
        <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`Minutes studied per day: ${bars.map((b) => `${b.minutes}`).join(", ")}`}>
          {bars.map((bar) => (
            <div key={bar.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${bar.day}: ${bar.minutes} min`}>
              <div
                className={`w-full rounded-t-md ${bar.counted ? "bg-[var(--brand-lime)]" : "bg-[var(--btn-secondary-bg)] border border-[var(--card-border)]"} ${bar.isToday ? "ring-2 ring-[var(--text-main)]/30" : ""}`}
                style={{ height: `${bar.heightPct}%` }}
              />
              <span className="text-[10px] text-[var(--text-muted)]">{bar.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">Green days counted toward your streak.</p>
      </section>

      <section className={card} aria-label="Study activity">
        <h2 className="mb-1 text-sm font-black">Activity, last 12 weeks</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          {formatStudyTime(month.totalSeconds)} in the last 30 days · {month.daysCounted} day{month.daysCounted === 1 ? "" : "s"} counted
          {month.averageSeconds > 0 && <> · about {formatStudyTime(month.averageSeconds)} on days you studied</>}
          {month.pomodoros > 0 && <> · {month.pomodoros} focus block{month.pomodoros === 1 ? "" : "s"}</>}
        </p>
        <div
          className="grid max-w-md gap-1 sm:gap-1.5" role="img"
          style={{ gridTemplateRows: "repeat(7, minmax(0, 1fr))", gridAutoFlow: "column", gridAutoColumns: "minmax(0, 1fr)" }}
          aria-label={`Study activity for the last 12 weeks. ${month.daysStudied} of the last 30 days had study.`}
        >
          {heat.flat().map((cell) => (
            <span
              key={cell.day} title={cell.future ? "" : `${cell.day}: ${cell.minutes} min`} data-level={cell.level} data-testid="heat-cell"
              className={`aspect-square rounded-[4px] ${cell.future ? "opacity-0" : ""} ${cell.isToday ? "ring-2 ring-[var(--text-main)]/50" : ""}`}
              style={{ background: HEAT_COLORS[cell.level] }}
            />
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">Less
          {[0, 1, 2, 3, 4].map((l) => <span key={l} className="h-3 w-3 rounded-[3px]" style={{ background: HEAT_COLORS[l] }} />)}
          More</p>
      </section>

      {byVideo.length > 0 && (
        <section className={card} aria-label="Where your time went">
          <h2 className="mb-3 text-sm font-black">Where your time went <span className="font-normal text-[var(--text-muted)]">(last 30 days)</span></h2>
          <ul className="grid gap-3">
            {byVideo.map((v) => (
              <li key={v.video_id}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <Link href={`/video/${v.video_id}`} className="min-w-0 truncate font-bold hover:underline">{v.title}</Link>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">{formatStudyTime(v.seconds)}</span>
                </div>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]">
                  <span className="block h-full rounded-full bg-[var(--brand-lime)]" style={{ width: `${Math.max(3, Math.round((v.seconds / topVideoSeconds) * 100))}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sessions.length > 0 && (
        <section className={card} aria-label="Recent sessions">
          <h2 className="mb-3 text-sm font-black">Recent sessions</h2>
          <ul className="divide-y divide-[var(--card-border)]">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-bold">{s.title ?? "Study session"}</p>
                  <p className="text-xs text-[var(--text-muted)]">{new Date(s.started_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                </div>
                <div className="shrink-0 text-right text-xs tabular-nums">
                  <p className="font-bold">{formatStudyTime(s.seconds)}</p>
                  {s.pomodoros > 0 && <p className="text-[var(--text-muted)]">{s.pomodoros} focus block{s.pomodoros === 1 ? "" : "s"}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={card} aria-label="Daily goals">
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-black"><Target className="h-4 w-4" /> Daily goals</h2>
        <p className="mb-4 text-xs text-[var(--text-muted)]">Pick what you want to do every day. You get a notification when you reach a goal.</p>
        <ul className="grid gap-3">
          {GOAL_TYPES.map((g) => {
            const progress = data.goals.find((x) => x.type === g.type && x.active);
            const row = draft[g.type];
            return (
              <li key={g.type} className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--card-border)] p-3">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input type="checkbox" checked={row.enabled} onChange={(e) => setDraft({ ...draft, [g.type]: { ...row, enabled: e.target.checked } })} className="h-4 w-4 accent-[var(--brand-lime)]" />
                  {g.label}
                </label>
                <label className="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span className="sr-only">Target {g.unit}</span>
                  <input
                    type="number" min={1} max={g.max} value={row.target} disabled={!row.enabled}
                    onChange={(e) => setDraft({ ...draft, [g.type]: { ...row, target: Number(e.target.value) } })}
                    className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--bg-app)] px-2 py-1 text-sm text-[var(--text-main)] disabled:opacity-50"
                  />
                  {g.unit} a day
                </label>
                {progress && (
                  <p className="w-full text-xs text-[var(--text-muted)]">
                    {goalLabel(progress.type, progress.target)}: {progress.progress} of {progress.target} {progress.done && "· done"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <button onClick={saveGoals} disabled={saving} className="mt-4 rounded-full bg-[var(--brand-lime)] px-5 py-2 text-sm font-black text-[#0E0F0C] disabled:opacity-60 cursor-pointer">
          {saving ? "Saving…" : "Save goals"}
        </button>
      </section>

      <p className="text-center text-xs text-[var(--text-muted)]">
        Study time counts while you watch or read in a video page. <Link href="/library" className="underline">Open your library</Link> to start.
      </p>
    </div>
  );
}
