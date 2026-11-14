"use client";

import React, { useState } from "react";
import { adminGet, query, type AuditEntry, type Paged } from "../../../features/admin/api";
import { ago, describeAction, ROLE_LABEL } from "../../../features/admin/format";
import { Badge, Empty, ErrorNote, Loading, PageTitle, Pager, SearchBox, inputClass, useQuery } from "../../../features/admin/ui";

const LIMIT = 50;
const ACTIONS = ["", "user.", "ticket.", "output.", "staff."];

export default function AuditPage() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useQuery(() => adminGet<Paged<AuditEntry>>(`/audit${query({ actor, action, limit: LIMIT, offset })}`), `${actor}|${action}|${offset}`);

  return (
    <div>
      <PageTitle title="Audit log" hint="Every change staff make, and every time someone opens an account. It cannot be edited or deleted.">
        <div className="flex flex-wrap gap-2">
          <select className={inputClass} aria-label="Kind of action" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }}>
            {ACTIONS.map((a) => <option key={a} value={a}>{a ? `${a}…` : "All actions"}</option>)}
          </select>
          <SearchBox value={actor} onSearch={(text) => { setActor(text); setOffset(0); }} placeholder="Who (email)" label="Filter by person" />
        </div>
      </PageTitle>
      {error && <ErrorNote message={error} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty>Nothing recorded yet.</Empty>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-[var(--card-border)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          {data.items.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <p className="text-sm font-bold">{describeAction(e.action, e.detail)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                <span>{e.actor ?? "unknown"}</span>
                {e.role && <Badge>{ROLE_LABEL[e.role] ?? e.role}</Badge>}
                <span title={e.at}>{ago(e.at)}</span>
                {e.target_id && <span className="break-all font-mono">{e.target_type}: {e.target_id}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
    </div>
  );
}
