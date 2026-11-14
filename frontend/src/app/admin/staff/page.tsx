"use client";

import React, { useState } from "react";
import { adminCall, adminGet, type StaffMember } from "../../../features/admin/api";
import { useStaffContext } from "../../../features/admin/AdminShell";
import { ago, ROLE_LABEL } from "../../../features/admin/format";
import { Badge, ErrorNote, Loading, PageTitle, Panel, buttonClass, dangerButtonClass, inputClass, primaryButtonClass, useQuery } from "../../../features/admin/ui";

interface StaffList { items: StaffMember[]; max_admins: number; roles: Record<string, string[]> }

const ABILITIES: [string, string][] = [
  ["Overview and support tickets", "tickets.manage"],
  ["Look at users and videos", "users.view"],
  ["See full email addresses", "users.pii"],
  ["Remove a bad shared study set", "outputs.reset"],
  ["Suspend accounts and change allowances", "users.suspend"],
  ["Queue health and alerts", "system.view"],
  ["Manage staff and read the audit log", "staff.manage"],
];

export default function StaffPage() {
  const me = useStaffContext();
  const { data, error, loading, setData } = useQuery(() => adminGet<StaffList>("/staff"), "staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "sub_admin">("sub_admin");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const canManage = me.can("staff.manage");

  const change = async (run: () => Promise<StaffList>, after?: () => void) => {
    setBusy(true);
    setFailure(null);
    try {
      setData(await run());
      after?.();
    } catch (err: unknown) {
      setFailure(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorNote message={error ?? "Could not load staff."} />;

  const admins = data.items.filter((s) => s.role === "admin").length;

  return (
    <div>
      <PageTitle title="Staff" hint={`${admins} of ${data.max_admins} admin places used. Admins are the main leads; sub-admins handle support.`} />

      <Panel title="Add someone">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void change(() => adminCall<StaffList>("POST", "/staff", { email, role }), () => setEmail("")); }}>
          <label className="block min-w-60 flex-1 text-xs font-bold">Their email
            <input className={`${inputClass} mt-1 w-full`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="They must have signed in once" required />
          </label>
          <label className="block text-xs font-bold">Role
            <select className={`${inputClass} mt-1 block`} value={role} onChange={(e) => setRole(e.target.value as "admin" | "sub_admin")}>
              <option value="sub_admin">Sub-admin</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className={primaryButtonClass} disabled={busy || !email.trim()} type="submit">Give access</button>
        </form>
        {failure && <div className="mt-3"><ErrorNote message={failure} /></div>}
      </Panel>

      <ul className="mt-6 divide-y divide-[var(--card-border)] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)]">
        {data.items.map((s) => {
          const mine = s.id === me.userId;
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.email}{mine && <span className="font-normal text-[var(--text-muted)]"> (you)</span>}</span>
              <Badge tone={s.role === "admin" ? "brand" : "neutral"}>{ROLE_LABEL[s.role]}</Badge>
              <span className="text-xs text-[var(--text-muted)]">since {ago(s.created_at)}{s.granted_by ? ` · by ${s.granted_by}` : ""}</span>
              {canManage && !mine && (
                <span className="flex gap-2">
                  <button className={`${buttonClass} h-8 px-3 text-xs`} disabled={busy}
                    onClick={() => void change(() => adminCall<StaffList>("PUT", `/staff/${s.id}`, { role: s.role === "admin" ? "sub_admin" : "admin" }))}>
                    Make {s.role === "admin" ? "sub-admin" : "admin"}
                  </button>
                  <button className={`${dangerButtonClass} h-8 px-3 text-xs`} disabled={busy}
                    onClick={() => { if (window.confirm(`Remove ${s.email}'s access?`)) void change(() => adminCall<StaffList>("DELETE", `/staff/${s.id}`)); }}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <Panel title="What each role can do" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-[var(--text-muted)]"><th className="py-1 pr-4 font-bold">Ability</th><th className="px-3 font-bold">Sub-admin</th><th className="px-3 font-bold">Admin</th></tr></thead>
            <tbody>
              {ABILITIES.map(([label, permission]) => {
                const yes = (role: string) => data.roles[role]?.includes(permission);
                return (
                  <tr key={permission} className="border-t border-[var(--card-border)]">
                    <td className="py-1.5 pr-4">{label}</td>
                    <td className="px-3">{yes("sub_admin") ? "Yes" : "No"}</td>
                    <td className="px-3">{yes("admin") ? "Yes" : "No"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Nobody can change their own role, the last admin cannot be removed, and every change is written to the audit log.
        </p>
      </Panel>
    </div>
  );
}
