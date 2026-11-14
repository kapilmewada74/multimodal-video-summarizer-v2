"use client";

import React, { useState } from "react";
import Link from "next/link";
import { adminGet, query, type Paged, type UserRow } from "../../../features/admin/api";
import { useStaffContext } from "../../../features/admin/AdminShell";
import { UserBadges } from "../../../features/admin/badges";
import { ago } from "../../../features/admin/format";
import { Badge, Empty, ErrorNote, Loading, PageTitle, Pager, SearchBox, buttonClass, useQuery } from "../../../features/admin/ui";

const KINDS = [["all", "Everyone"], ["accounts", "Accounts"], ["guests", "Guests"], ["suspended", "Suspended"]] as const;
const LIMIT = 25;

export default function UsersPage() {
  const staff = useStaffContext();
  const [kind, setKind] = useState<string>("all");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, error, loading } = useQuery(() => adminGet<Paged<UserRow>>(`/users${query({ q, kind, limit: LIMIT, offset })}`), `${kind}|${q}|${offset}`);
  const searchHint = staff.can("users.pii") ? "Search by name, email or id" : "Search by full email, id or start of a name";

  return (
    <div>
      <PageTitle title="Users" hint={staff.can("users.pii") ? undefined : "Email addresses are partly hidden for your role."}>
        <SearchBox value={q} onSearch={(text) => { setQ(text); setOffset(0); }} placeholder={searchHint} label="Search users" />
      </PageTitle>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter people">
        {KINDS.map(([value, label]) => (
          <button key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setOffset(0); }}
            className={`${buttonClass} h-9 px-3 text-xs ${kind === value ? "!border-[var(--brand-lime-hover)] !bg-[var(--brand-lime)] !text-[#0E0F0C]" : ""}`}>{label}</button>
        ))}
      </div>

      {error && <ErrorNote message={error} />}
      {loading && !data && <Loading />}
      {data && data.items.length === 0 && <Empty>No one matches.</Empty>}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-[var(--card-border)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
          {data.items.map((u) => (
            <li key={u.id}>
              <Link href={`/admin/users/${u.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-[var(--btn-secondary-bg)]">
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{u.email ?? (u.guest ? "Guest (no email)" : u.id)}{u.name ? <span className="font-normal text-[var(--text-muted)]"> · {u.name}</span> : null}</span>
                <span className="flex gap-1.5"><UserBadges user={u} /></span>
                <span className="w-20 text-right text-xs text-[var(--text-muted)]">{u.videos} videos</span>
                <span className="w-24 text-right text-xs text-[var(--text-muted)]">seen {ago(u.last_sign_in_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
    </div>
  );
}
