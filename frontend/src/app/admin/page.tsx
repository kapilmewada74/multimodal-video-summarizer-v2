"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { adminGet, type Overview } from "../../features/admin/api";
import { useStaffContext } from "../../features/admin/AdminShell";
import { waiting } from "../../features/admin/format";
import { Badge, ErrorNote, Loading, PageTitle, Panel, Stat, useQuery } from "../../features/admin/ui";

export default function AdminOverviewPage() {
  const staff = useStaffContext();
  const { data, error, loading } = useQuery(() => adminGet<Overview>("/overview"), "overview");

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load the overview."} />;
  const { users, activity, support, system, alerts } = data;

  return (
    <div>
      <PageTitle title="Overview" hint="Numbers refresh whenever you open this page." />

      {alerts && (
        <Panel className="mb-6">
          {alerts.length === 0 ? (
            <p className="flex items-center gap-2 text-sm font-bold"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Everything looks healthy.</p>
          ) : (
            <ul className="space-y-1.5">
              {alerts.map((a) => (
                <li key={a} className="flex items-start gap-2 text-sm font-bold text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {a}</li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-[var(--text-muted)]">People</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Accounts" value={users.accounts} />
        <Stat label="Guests" value={users.guests} hint="free try-out" />
        <Stat label="New today" value={users.new_24h} hint={`${users.new_7d} this week`} />
        <Stat label="Active today" value={activity.active_24h} hint="submitted a video" />
        <Stat label="Suspended" value={users.suspended} tone={users.suspended ? "warn" : undefined} />
      </div>

      <h2 className="mb-2 text-sm font-black uppercase tracking-wider text-[var(--text-muted)]">Activity</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Videos in the library" value={activity.videos_total} />
        <Stat label="Videos submitted today" value={activity.jobs_24h} hint="last 24 hours" />
        <Stat label="Generations today" value={activity.generations_today} hint="study sets made by AI" />
        {system && <Stat label="Failed on our side" value={system.last_24h.failed_system} hint="last 24 hours" tone={system.last_24h.failed_system ? "warn" : undefined} />}
      </div>

      {staff.can("tickets.view") && (
        <Link href="/admin/support" className="mb-6 block rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 transition-colors hover:border-[var(--brand-lime-hover)] sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider text-[var(--text-muted)]">Support</h2>
              <p className="mt-1 text-sm">
                <strong>{support.open}</strong> waiting for a first look, <strong>{support.in_progress}</strong> in progress.
              </p>
            </div>
            {support.open > 0 && <Badge tone="warn">Oldest waiting {waiting(support.oldest_open_seconds)}</Badge>}
          </div>
        </Link>
      )}

      {system && (
        <Panel title="Video queue">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-[var(--text-muted)]">Waiting</dt><dd className="text-lg font-black">{system.queue.waiting}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Processing</dt><dd className="text-lg font-black">{system.queue.processing}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Waiting to retry</dt><dd className="text-lg font-black">{system.queue.retrying}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Typical time</dt><dd className="text-lg font-black">{system.last_24h.avg_processing_seconds}s <span className="text-xs font-normal text-[var(--text-muted)]">(slowest 5%: {system.last_24h.p95_processing_seconds}s)</span></dd></div>
          </dl>
        </Panel>
      )}
    </div>
  );
}
