"use client";

import React from "react";
import { Minus, Pause, Play, Plus, RotateCcw, SkipForward, X } from "lucide-react";
import { IconButton } from "../../components/ui/IconButton";
import {
  LIMITS, PHASE_LABEL, PRESETS, formatCountdown, matchingPreset, phaseMs, type PomodoroSettings,
} from "./pomodoro";
import type { usePomodoro } from "./usePomodoro";

type Timer = ReturnType<typeof usePomodoro>;

const RING = 52;
const CIRCUMFERENCE = 2 * Math.PI * RING;
const COLORS = { focus: "var(--brand-lime)", short: "#38A3D8", long: "#8B6FD6" } as const;

function Stepper({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void;
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n) || min)));
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="font-bold text-[var(--text-main)]">{label}</span>
      <span className="flex items-center gap-1">
        <IconButton label={`Less ${label.toLowerCase()}`} size="sm" disabled={value <= min} onClick={() => set(value - 1)}><Minus className="h-3 w-3" /></IconButton>
        <input
          type="number" min={min} max={max} value={value} aria-label={`${label} (${unit})`}
          onChange={(e) => set(Number(e.target.value))}
          className="h-8 w-14 rounded-lg border border-[var(--card-border)] bg-[var(--bg-app)] text-center text-sm font-bold tabular-nums text-[var(--text-main)]"
        />
        <IconButton label={`More ${label.toLowerCase()}`} size="sm" disabled={value >= max} onClick={() => set(value + 1)}><Plus className="h-3 w-3" /></IconButton>
        <span className="w-7 text-[var(--text-muted)]">{unit}</span>
      </span>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-bold text-[var(--text-main)]">
      {label}
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--brand-lime)]" />
    </label>
  );
}

/** The focus timer: countdown ring, start/pause/skip/reset, presets and your own lengths. */
export function PomodoroCard({ timer, todayPomodoros, onClose, showSettings }: {
  timer: Timer;
  /** Finished focus blocks today, from the server. */
  todayPomodoros: number;
  onClose: () => void;
  showSettings: boolean;
}) {
  const { settings, state, remaining, progress, running } = timer;
  const preset = matchingPreset(settings);
  const color = COLORS[state.phase];
  const change = (patch: Partial<PomodoroSettings>) => timer.changeSettings({ ...settings, ...patch });
  const dots = Array.from({ length: settings.cycles }, (_, i) => i < state.doneInRound || (state.phase === "long" && state.doneInRound >= settings.cycles));

  return (
    <div className="border-t border-[var(--card-border)] px-4 py-4" role="group" aria-label="Focus timer">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-black">Focus timer</h3>
        <IconButton label="Close the focus timer" size="sm" onClick={onClose}><X className="h-3.5 w-3.5" /></IconButton>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-5">
        <div className="relative h-[124px] w-[124px] shrink-0">
          <svg viewBox="0 0 124 124" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="62" cy="62" r={RING} fill="none" stroke="var(--btn-secondary-bg)" strokeWidth="9" />
            <circle
              cx="62" cy="62" r={RING} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
              style={{ transition: running ? "stroke-dashoffset 0.5s linear" : "none" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span role="timer" aria-live="off" aria-label={`${PHASE_LABEL[state.phase]}, ${formatCountdown(remaining)} left`} className="text-2xl font-black tabular-nums">{formatCountdown(remaining)}</span>
            <span className="text-[11px] font-bold text-[var(--text-muted)]">{PHASE_LABEL[state.phase]}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={timer.toggle}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--brand-lime)] px-5 text-sm font-black text-[#0E0F0C] cursor-pointer active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--text-main)]"
            >
              {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {running ? "Pause" : state.remainingMs < phaseMs(state.phase, settings) ? "Resume" : "Start"}
            </button>
            <IconButton label="Skip to the next phase" onClick={timer.skip}><SkipForward className="h-4 w-4" /></IconButton>
            <IconButton label="Reset the timer" onClick={timer.reset}><RotateCcw className="h-4 w-4" /></IconButton>
          </div>
          <div className="mt-3 flex items-center gap-1.5" role="img" aria-label={`${Math.min(state.doneInRound, settings.cycles)} of ${settings.cycles} focus blocks done in this round`}>
            {dots.map((done, i) => (
              <span key={i} className={`h-2.5 w-2.5 rounded-full ${done ? "bg-[var(--brand-lime)]" : "border border-[var(--card-border)] bg-[var(--btn-secondary-bg)]"}`} />
            ))}
            <span className="ml-2 text-xs text-[var(--text-muted)]">{todayPomodoros} focus block{todayPomodoros === 1 ? "" : "s"} today</span>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Only focus time counts as study time. Breaks do not.
          </p>
        </div>
      </div>

      {showSettings && (
        <div className="mt-4 grid gap-4 rounded-2xl bg-[var(--btn-secondary-bg)] p-3 sm:grid-cols-2" role="group" aria-label="Timer settings">
          <div className="sm:col-span-2">
            <p className="mb-2 text-xs font-bold text-[var(--text-muted)]">Presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id} type="button" aria-pressed={preset?.id === p.id} title={p.hint}
                  onClick={() => change({ focusMin: p.focusMin, shortMin: p.shortMin, longMin: p.longMin, cycles: p.cycles })}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer ${
                    preset?.id === p.id ? "border-transparent bg-[var(--brand-lime)] text-[#0E0F0C]" : "border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-main)]"
                  }`}
                >
                  {p.name} <span className="font-normal opacity-70">{p.focusMin}/{p.shortMin}</span>
                </button>
              ))}
              <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${preset ? "border-dashed border-[var(--card-border)] text-[var(--text-muted)]" : "border-transparent bg-[var(--brand-lime)] text-[#0E0F0C]"}`}>
                {preset ? "Custom: change a length below" : "Custom"}
              </span>
            </div>
          </div>
          <div className="grid gap-2">
            <Stepper label="Focus" unit="min" value={settings.focusMin} {...LIMITS.focusMin} onChange={(v) => change({ focusMin: v })} />
            <Stepper label="Short break" unit="min" value={settings.shortMin} {...LIMITS.shortMin} onChange={(v) => change({ shortMin: v })} />
            <Stepper label="Long break" unit="min" value={settings.longMin} {...LIMITS.longMin} onChange={(v) => change({ longMin: v })} />
            <Stepper label="Blocks per round" unit="" value={settings.cycles} {...LIMITS.cycles} onChange={(v) => change({ cycles: v })} />
          </div>
          <div className="grid content-start gap-2.5">
            <Toggle label="Start breaks automatically" checked={settings.autoStartBreaks} onChange={(v) => change({ autoStartBreaks: v })} />
            <Toggle label="Start the next focus block automatically" checked={settings.autoStartFocus} onChange={(v) => change({ autoStartFocus: v })} />
            <Toggle label="Play a sound at the end" checked={settings.sound} onChange={(v) => change({ sound: v })} />
            <Toggle label="Show a notification at the end" checked={settings.notify} onChange={(v) => change({ notify: v })} />
            <p className="text-[11px] text-[var(--text-muted)]">Saved on this device. A running timer is not changed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
