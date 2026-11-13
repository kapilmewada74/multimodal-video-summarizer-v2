"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, FileText, Files, HardDrive, Loader2, Sparkles, Upload, Video } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { Avatar } from "../auth/AccountMenu";
import { useAuth } from "../auth/AuthProvider";
import { formatReset } from "../limits/usage";
import type { Profile } from "../auth/session";
import { formatBytes, formatExtensions, formatSeconds, percent, type AccountLimits } from "./limits";

function Bar({ value, label }: { value: number; label: string }) {
  const full = value >= 100;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-2 w-full overflow-hidden rounded-full bg-[var(--btn-secondary-bg)]">
      <div className={`h-full rounded-full transition-all ${full ? "bg-amber-500" : "bg-[var(--brand-lime)]"}`} style={{ width: `${Math.max(value, value > 0 ? 3 : 0)}%` }} />
    </div>
  );
}

function UsageCard({ icon, title, used, limit, note, resets }: { icon: React.ReactNode; title: string; used: number; limit: number; note: string; resets: string }) {
  const value = percent(used, limit);
  return (
    <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-muted)]">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-lime)] text-[#0E0F0C]">{icon}</span> {title}
      </div>
      <p className="mt-4 text-3xl font-black tracking-tight text-[var(--text-main)]">
        {used} <span className="text-lg font-bold text-[var(--text-muted)]">of {limit}</span>
      </p>
      <div className="mt-3"><Bar value={value} label={`${title} used today`} /></div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">{note}</p>
      <p className="mt-1 text-xs font-semibold text-[var(--text-main)]">{formatReset(resets)}</p>
    </div>
  );
}

function Row({ icon, label, value, hint, children }: { icon: React.ReactNode; label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-4">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--btn-secondary-bg)] text-[var(--text-main)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <p className="text-sm font-bold text-[var(--text-main)]">{label}</p>
          <p className="text-sm font-black text-[var(--text-main)]">{value}</p>
        </div>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p>}
        {children}
      </div>
    </li>
  );
}

interface ViewProps {
  profile: Profile;
  usesGoogle: boolean;
  limits: AccountLimits | null;
  failed: boolean;
}

/** "About and Usage": who you are, today's usage and every limit (uploads, video length, documents, storage). */
export function AccountOverviewView({ profile, usesGoogle, limits, failed }: ViewProps) {
  const storagePercent = limits ? percent(limits.storage.used_bytes, limits.storage.quota_bytes) : 0;
  return (
    <div>
      <h1 className="text-2xl font-black tracking-tight sm:text-3xl">About and Usage</h1>

      <section aria-label="Profile" className="mt-6 flex items-center gap-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <Avatar profile={profile} size={56} />
        <div className="min-w-0">
          <p className="truncate text-lg font-black text-[var(--text-main)]">{profile.name ?? profile.email ?? "Your account"}</p>
          {profile.name && profile.email && <p className="truncate text-sm text-[var(--text-muted)]">{profile.email}</p>}
          <p className="mt-1 inline-block rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--text-muted)]">
            Signed in with {usesGoogle ? "Google" : "an emailed link"}
          </p>
        </div>
      </section>

      {failed && (
        <p role="alert" className="mt-6 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 text-center text-sm">
          We could not load your usage right now. Please try again in a moment.
        </p>
      )}
      {!limits && !failed && (
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your usage…
        </div>
      )}

      {limits && (
        <>
          <h2 className="mt-8 text-lg font-black">Today</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <UsageCard
              icon={<Video className="h-4 w-4" />}
              title="Videos"
              used={limits.videos.used}
              limit={limits.videos.limit}
              resets={limits.videos.resets_at}
              note="Each video you summarize counts once, even if someone else already summarized it. Failures on our side are not counted."
            />
            <UsageCard
              icon={<Sparkles className="h-4 w-4" />}
              title="AI generations"
              used={limits.generations.used}
              limit={limits.generations.limit}
              resets={limits.generations.resets_at}
              note="Flashcards, quizzes, mind maps and slides you create. Opening ones that already exist is free."
            />
          </div>

          <h2 className="mt-8 text-lg font-black">Limits</h2>
          <ul className="mt-2 divide-y divide-[var(--card-border)] rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-5">
            <Row icon={<Upload className="h-4 w-4" />} label="Video or audio upload" value={`${formatBytes(limits.uploads.max_bytes)} per file`}
              hint={`Accepted: ${formatExtensions(limits.uploads.extensions)}. Pasting a YouTube link has no file size limit.`} />
            <Row icon={<Clock className="h-4 w-4" />} label="Video length" value={`Up to ${formatSeconds(limits.uploads.max_video_seconds)}`}
              hint="Longer videos are not processed." />
            <Row icon={<FileText className="h-4 w-4" />} label="Documents" value={`${formatBytes(limits.documents.max_bytes)} per file`}
              hint={`Accepted: ${formatExtensions(limits.documents.extensions)}.`} />
            <Row icon={<Files className="h-4 w-4" />} label="Number of documents" value={`${limits.documents.count} of ${limits.documents.max_count}`} />
            <Row icon={<HardDrive className="h-4 w-4" />} label="Storage" value={`${formatBytes(limits.storage.used_bytes)} of ${formatBytes(limits.storage.quota_bytes)}`}
              hint="Your documents and uploaded videos together.">
              <div className="mt-2"><Bar value={storagePercent} label="Storage used" /></div>
            </Row>
          </ul>
        </>
      )}

      <section aria-label="About" className="mt-8 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 text-sm leading-relaxed text-[var(--text-muted)]">
        <h2 className="text-lg font-black text-[var(--text-main)]">About SUMMARIZE.AI</h2>
        <p className="mt-2">
          SUMMARIZE.AI turns a video into study material: a summary, transcript, flashcards, mind map, slides and a quiz.
          Limits keep the service fair and fast for everyone. They reset every day.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-semibold">
          <Link href="/privacy" className="underline underline-offset-2 hover:text-[var(--text-main)]">Privacy</Link>
          <Link href="/terms" className="underline underline-offset-2 hover:text-[var(--text-main)]">Terms</Link>
          <Link href="/settings" className="underline underline-offset-2 hover:text-[var(--text-main)]">Notifications and your data</Link>
        </p>
      </section>
    </div>
  );
}

/** Loads the figures for the signed-in person and shows them. */
export function AccountOverview() {
  const { ready, signedIn, profile, usesGoogle } = useAuth();
  const [limits, setLimits] = useState<AccountLimits | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready || !signedIn) return;
    let cancelled = false;
    apiFetch("/api/me/limits")
      .then((res) => (res.ok ? (res.json() as Promise<AccountLimits>) : Promise.reject(new Error("failed"))))
      .then((data) => !cancelled && setLimits(data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [ready, signedIn]);

  return <AccountOverviewView profile={profile} usesGoogle={usesGoogle} limits={limits} failed={failed} />;
}
