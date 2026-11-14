"use client";

import React, { useState } from "react";
import { adminCall, adminGet, query, type Paged, type VideoDetail, type VideoRow } from "../../../features/admin/api";
import { useStaffContext } from "../../../features/admin/AdminShell";
import { ago } from "../../../features/admin/format";
import { Badge, Empty, ErrorNote, Loading, PageTitle, Pager, Panel, SearchBox, dangerButtonClass, inputClass, useQuery } from "../../../features/admin/ui";

const LIMIT = 20;
const KIND_LABEL: Record<string, string> = { flashcards: "Flashcards", quiz: "Quiz", mindmap: "Mind map", slides: "Slides" };

function VideoPanel({ video, onChanged }: { video: VideoRow; onChanged: () => void }) {
  const staff = useStaffContext();
  const { data, error, loading, reload } = useQuery(() => adminGet<VideoDetail>(`/videos/${video.id}`), video.id);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const remove = async (kind: string, variant: string) => {
    if (!window.confirm(`Remove the shared ${KIND_LABEL[kind] ?? kind} copy? The next person to open it will get a freshly generated one.`)) return;
    setBusy(true);
    setFailure(null);
    try {
      await adminCall("POST", `/videos/${video.id}/outputs/reset`, { kind, variant: variant || null, reason });
      setReason("");
      reload();
      onChanged();
    } catch (err: unknown) {
      setFailure(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load this video."} />;

  return (
    <Panel className="mt-2 !bg-[var(--bg-app)]">
      <p className="text-xs text-[var(--text-muted)]">
        Id <span className="font-mono">{data.id}</span> · {data.users} {data.users === 1 ? "person has" : "people have"} it · staff cannot see its text.
      </p>
      {data.shared_outputs.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">No shared study sets have been generated for this video yet.</p> : (
        <ul className="mt-3 space-y-2">
          {data.shared_outputs.map((o) => (
            <li key={`${o.kind}:${o.variant}`} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-bold">{KIND_LABEL[o.kind] ?? o.kind}{o.variant ? ` (${o.variant})` : ""}</span>
              <span className="text-xs text-[var(--text-muted)]">made {ago(o.created_at)}{data.personal_copies[o.kind] ? ` · ${data.personal_copies[o.kind]} personal copies` : ""}</span>
              {staff.can("outputs.reset") && (
                <button className={`${dangerButtonClass} ml-auto h-8 px-3 text-xs`} disabled={busy || reason.trim().length < 3} onClick={() => void remove(o.kind, o.variant)}>Remove shared copy</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {staff.can("outputs.reset") && data.shared_outputs.length > 0 && (
        <label className="mt-3 block text-xs font-bold">Why is it being removed? (kept in the audit log)
          <input className={`${inputClass} mt-1 w-full`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="For example: answers are wrong" />
        </label>
      )}
      {failure && <div className="mt-3"><ErrorNote message={failure} /></div>}
    </Panel>
  );
}

export default function VideosPage() {
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useQuery(() => adminGet<Paged<VideoRow>>(`/videos${query({ q, limit: LIMIT, offset })}`), `${q}|${offset}`);

  return (
    <div>
      <PageTitle title="Videos" hint="Find a video, and remove a bad shared study set so it is made again.">
        <SearchBox value={q} onSearch={(text) => { setQ(text); setOffset(0); setOpen(null); }} placeholder="Title, YouTube id or video id" label="Search videos" />
      </PageTitle>
      {error && <ErrorNote message={error} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty>No videos match.</Empty>}
      {data && data.items.length > 0 && (
        <ul className="space-y-2">
          {data.items.map((v) => (
            <li key={v.id}>
              <button onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}
                className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3 text-left transition-colors hover:border-[var(--brand-lime-hover)]">
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{v.title ?? "(processing)"}</span>
                <span className="flex flex-wrap gap-1.5">{v.outputs.map((o) => <Badge key={o}>{KIND_LABEL[o] ?? o}</Badge>)}</span>
                <span className="text-xs text-[var(--text-muted)]">{v.source}{v.youtube_id ? ` · ${v.youtube_id}` : ""}</span>
                <span className="w-20 text-right text-xs text-[var(--text-muted)]">{v.users} users</span>
              </button>
              {open === v.id && <VideoPanel video={v} onChanged={reload} />}
            </li>
          ))}
        </ul>
      )}
      {data && <Pager total={data.total} offset={offset} limit={LIMIT} onChange={(next) => { setOffset(next); setOpen(null); }} />}
    </div>
  );
}
