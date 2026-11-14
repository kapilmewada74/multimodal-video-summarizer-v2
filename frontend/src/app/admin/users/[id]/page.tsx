"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { adminCall, adminGet, type UserDetail } from "../../../../features/admin/api";
import { useStaffContext } from "../../../../features/admin/AdminShell";
import { ago, STATUS_LABEL } from "../../../../features/admin/format";
import { Badge, ErrorNote, Loading, Panel, Stat, buttonClass, dangerButtonClass, inputClass, primaryButtonClass, useQuery } from "../../../../features/admin/ui";
import { UserBadges } from "../../../../features/admin/badges";

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const staff = useStaffContext();
  const { data, error, loading, reload } = useQuery(() => adminGet<UserDetail>(`/users/${id}`), id);
  const [reason, setReason] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { if (data) setLimit(String(data.daily_video_limit)); }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load this account."} />;

  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    setFailure(null);
    try {
      await adminCall("POST", `/users/${id}/${path}`, body ?? {});
      setReason("");
      reload();
    } catch (err: unknown) {
      setFailure(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const isStaffAccount = !!data.role;

  return (
    <div>
      <Link href="/admin/users" className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]"><ArrowLeft className="h-4 w-4" /> All users</Link>

      <Panel>
        <div className="flex flex-wrap items-center gap-2"><UserBadges user={data} /></div>
        <h1 className="mt-2 break-all text-xl font-black tracking-tight">{data.email ?? (data.guest ? "Guest (no email)" : "No email")}</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {data.name ? `${data.name} · ` : ""}joined {ago(data.created_at)} · last seen {ago(data.last_sign_in_at)}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-[var(--text-muted)]">{data.id}</p>
        {data.suspended && data.suspended_reason && <p className="mt-3 text-sm"><strong>Suspended:</strong> {data.suspended_reason}</p>}
      </Panel>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Videos" value={data.videos} />
        <Stat label="Daily allowance" value={data.daily_video_limit} hint="videos per day" />
        <Stat label="Generations today" value={data.usage.generations_today} />
        <Stat label="Failed this week" value={data.usage.jobs_failed_7d} tone={data.usage.jobs_failed_7d ? "warn" : undefined} />
        <Stat label="Documents" value={data.usage.documents} />
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">Staff can see these counts but never what the person studied: no summaries, transcripts, notes or documents.</p>

      {(staff.can("users.suspend") || staff.can("users.limits")) && (
        <Panel title="Actions" className="mt-6">
          {isStaffAccount ? (
            <p className="text-sm text-[var(--text-muted)]">This person is staff. Change or remove their role under Staff first.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {staff.can("users.suspend") && (
                <div>
                  <p className="text-sm font-bold">{data.suspended ? "Lift the suspension" : "Suspend this account"}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {data.suspended ? "They can use the site again straight away." : "They are blocked within about 30 seconds and see a message asking them to contact us. Their data is kept."}
                  </p>
                  {data.suspended ? (
                    <button className={`${buttonClass} mt-3`} disabled={busy} onClick={() => void run("unsuspend")}>Unsuspend</button>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <input className={`${inputClass} min-w-0 flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (kept in the audit log)" aria-label="Reason" />
                      <button className={dangerButtonClass} disabled={busy || reason.trim().length < 3}
                        onClick={() => { if (window.confirm("Suspend this account?")) void run("suspend", { reason }); }}>Suspend</button>
                    </div>
                  )}
                </div>
              )}
              {staff.can("users.limits") && (
                <div>
                  <p className="text-sm font-bold">Daily video allowance</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">How many videos this person may add per day (0 to 1000).</p>
                  <div className="mt-3 flex gap-2">
                    <input className={`${inputClass} w-28`} type="number" min={0} max={1000} value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Daily allowance" />
                    <button className={primaryButtonClass} disabled={busy || limit === "" || Number(limit) === data.daily_video_limit}
                      onClick={() => void run("limit", { daily_video_limit: Number(limit) })}>Save</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {failure && <div className="mt-4"><ErrorNote message={failure} /></div>}
        </Panel>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Recent videos">
          {data.recent_jobs.length === 0 ? <p className="text-sm text-[var(--text-muted)]">None yet.</p> : (
            <ul className="space-y-2">
              {data.recent_jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={j.status === "completed" ? "good" : j.status === "failed" ? "bad" : "neutral"}>{j.status}</Badge>
                  <span className="text-xs text-[var(--text-muted)]">{j.source} · {ago(j.created_at)}</span>
                  {j.error && <span className="w-full break-words text-xs text-[var(--text-muted)]">{j.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Messages to support">
          {data.tickets.length === 0 ? <p className="text-sm text-[var(--text-muted)]">None.</p> : (
            <ul className="space-y-2">
              {data.tickets.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge>{STATUS_LABEL[t.status] ?? t.status}</Badge>
                  {staff.can("tickets.view") ? <Link href={`/admin/support/${t.id}`} className="font-bold underline">{t.subject}</Link> : <span>{t.subject}</span>}
                  <span className="text-xs text-[var(--text-muted)]">{ago(t.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
