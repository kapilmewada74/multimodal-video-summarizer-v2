"use client";

import React, { useState } from "react";
import Link from "next/link";
import { adminGet, query, type TicketList, type TicketStatus } from "../../../features/admin/api";
import { STATUS_TONE } from "../../../features/admin/badges";
import { ago, STATUS_LABEL } from "../../../features/admin/format";
import { Badge, Empty, ErrorNote, Loading, PageTitle, Pager, SearchBox, buttonClass, useQuery } from "../../../features/admin/ui";

const FILTERS = [["active", "Needs attention"], ["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"], ["spam", "Spam"], ["all", "All"]] as const;
const LIMIT = 25;

export default function SupportPage() {
  const [status, setStatus] = useState<string>("active");
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [offset, setOffset] = useState(0);
  const key = `${status}|${q}|${mine}|${offset}`;
  const { data, error, loading } = useQuery(() => adminGet<TicketList>(`/tickets${query({ status, q, mine, limit: LIMIT, offset })}`), key);

  const pick = (next: string) => { setStatus(next); setOffset(0); };

  return (
    <div>
      <PageTitle title="Support" hint="Messages from the Contact us form.">
        <SearchBox value={q} onSearch={(text) => { setQ(text); setOffset(0); }} placeholder="Search messages" label="Search messages" />
      </PageTitle>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map(([value, label]) => {
          const count = data && value !== "active" && value !== "all" ? data.counts[value as TicketStatus] : null;
          return (
            <button key={value} onClick={() => pick(value)} aria-pressed={status === value}
              className={`${buttonClass} h-9 px-3 text-xs ${status === value ? "!border-[var(--brand-lime-hover)] !bg-[var(--brand-lime)] !text-[#0E0F0C]" : ""}`}>
              {label}{count !== null ? ` · ${count}` : ""}
            </button>
          );
        })}
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setOffset(0); }} className="h-4 w-4 accent-[var(--brand-lime-hover)]" /> Only mine
        </label>
      </div>

      {error && <ErrorNote message={error} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty>Nothing here. {status === "active" ? "No messages need attention." : ""}</Empty>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-[var(--card-border)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          {data.items.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/support/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-[var(--btn-secondary-bg)]">
                <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{t.subject}</span>
                <span className="text-xs text-[var(--text-muted)]">{t.name ? `${t.name} · ` : ""}{t.email}</span>
                {t.assigned_to_email && <Badge>{t.assigned_to_email}</Badge>}
                <span className="w-20 text-right text-xs text-[var(--text-muted)]">{ago(t.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
    </div>
  );
}
