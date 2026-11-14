"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Mail, StickyNote } from "lucide-react";
import { adminCall, adminGet, type TicketDetail, type TicketStatus } from "../../../../features/admin/api";
import { useStaffContext } from "../../../../features/admin/AdminShell";
import { ago, STATUS_LABEL } from "../../../../features/admin/format";
import { Badge, ErrorNote, Loading, Panel, buttonClass, inputClass, primaryButtonClass, useQuery } from "../../../../features/admin/ui";
import { STATUS_TONE } from "../../../../features/admin/badges";

const EVENT_LABEL = { note: "Private note", reply: "Reply emailed", status: "Status", assign: "Owner" } as const;

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const staff = useStaffContext();
  const { data, error, loading, setData } = useQuery(() => adminGet<TicketDetail>(`/tickets/${id}`), id);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { setSent(false); }, [id]);

  const canManage = staff.can("tickets.manage");

  /** Runs a change; true when it worked. On failure the message shows and the person's typing is kept. */
  const act = async (run: () => Promise<TicketDetail>, after?: () => void): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      setData(await run());
      after?.();
      return true;
    } catch (err: unknown) {
      setFailure(err instanceof Error ? err.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load this message."} />;

  const update = (body: { status?: TicketStatus; assign?: "me" | "none"; note?: string }) => act(() => adminCall<TicketDetail>("POST", `/tickets/${id}`, body));

  return (
    <div>
      <Link href="/admin/support" className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]"><ArrowLeft className="h-4 w-4" /> All messages</Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>
              <Badge>{data.category}</Badge>
              <span className="text-xs text-[var(--text-muted)]">{ago(data.created_at)}</span>
            </div>
            <h1 className="mt-3 text-xl font-black tracking-tight">{data.subject}</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{data.name ? `${data.name} · ` : ""}{data.email}</p>
            {/* Plain text only: a visitor's message is never treated as markup. */}
            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{data.message}</p>
          </Panel>

          <Panel title="History">
            {data.events.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Nothing yet.</p> : (
              <ol className="space-y-3">
                {data.events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="text-xs text-[var(--text-muted)]">
                      <strong className="text-[var(--text-main)]">{EVENT_LABEL[e.kind]}</strong> · {e.by ?? "someone"} · {ago(e.created_at)}
                    </p>
                    {e.body && <p className="mt-0.5 whitespace-pre-wrap break-words">{e.body}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {canManage && (
            <Panel title="Reply by email">
              {sent && <p role="status" className="mb-3 text-sm font-bold text-emerald-700 dark:text-emerald-300">Sent.</p>}
              <textarea className={`${inputClass} h-auto min-h-32 w-full py-2.5`} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000}
                aria-label="Reply" placeholder={`Write to ${data.email ?? "the sender"}. They receive this as an email.`} />
              <div className="mt-3 flex justify-end">
                <button className={primaryButtonClass} disabled={busy || reply.trim().length < 5}
                  onClick={() => void act(() => adminCall<TicketDetail>("POST", `/tickets/${id}/reply`, { message: reply }), () => { setReply(""); setSent(true); })}>
                  <Mail className="h-4 w-4" /> Send reply
                </button>
              </div>
            </Panel>
          )}
        </div>

        {canManage && (
          <aside className="space-y-6">
            <Panel title="Ticket">
              <label className="block text-xs font-bold">Status
                <select className={`${inputClass} mt-1 w-full`} value={data.status} disabled={busy} onChange={(e) => void update({ status: e.target.value as TicketStatus })}>
                  {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
              <p className="mt-4 text-xs font-bold">Owner</p>
              <p className="mt-1 text-sm">{data.assigned_to_email ?? "Nobody yet"}</p>
              <button className={`${buttonClass} mt-2 w-full`} disabled={busy} onClick={() => void update({ assign: data.assigned_to === staff.userId ? "none" : "me" })}>
                {data.assigned_to === staff.userId ? "Release" : "Take this ticket"}
              </button>
              {data.user_id && staff.can("users.view") && (
                <Link href={`/admin/users/${data.user_id}`} className="mt-4 block text-sm font-bold underline">Open their account</Link>
              )}
            </Panel>

            <Panel title="Private note">
              <textarea className={`${inputClass} h-auto min-h-24 w-full py-2.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000}
                aria-label="Private note" placeholder="Only staff can see this." />
              <button className={`${buttonClass} mt-2 w-full`} disabled={busy || !note.trim()} onClick={() => void update({ note }).then((ok) => ok && setNote(""))}>
                <StickyNote className="h-4 w-4" /> Add note
              </button>
            </Panel>
            {failure && <ErrorNote message={failure} />}
          </aside>
        )}
      </div>
      {!canManage && failure && <ErrorNote message={failure} />}
    </div>
  );
}
