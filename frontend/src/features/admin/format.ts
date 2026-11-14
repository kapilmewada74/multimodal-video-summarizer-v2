/** Small formatting helpers for the admin screens (pure, so they are easy to test). */

export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const units: [number, string][] = [[86400 * 30, "mo"], [86400, "d"], [3600, "h"], [60, "min"]];
  for (const [size, label] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)} ${label} ago`;
  }
  return "just now";
}

export function waiting(seconds: number): string {
  if (!seconds || seconds < 60) return "under a minute";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} d`;
}

export const ROLE_LABEL: Record<string, string> = { admin: "Admin", sub_admin: "Sub-admin" };

export const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", resolved: "Resolved", spam: "Spam",
};

/** A staff action as a sentence, for the audit log. Unknown actions fall back to the raw name, never to nothing. */
export function describeAction(action: string, detail: Record<string, unknown> = {}): string {
  const text = (key: string) => (typeof detail[key] === "string" ? (detail[key] as string) : "");
  switch (action) {
    case "user.view": return "Opened an account";
    case "user.suspend": return `Suspended an account${text("reason") ? `: ${text("reason")}` : ""}`;
    case "user.unsuspend": return "Lifted a suspension";
    case "user.limit": return `Changed a daily allowance from ${String(detail.from ?? "?")} to ${String(detail.to ?? "?")}`;
    case "ticket.status": return `Moved a ticket from ${STATUS_LABEL[text("from")] ?? text("from")} to ${STATUS_LABEL[text("to")] ?? text("to")}`;
    case "ticket.assign": return detail.to ? "Took a ticket" : "Released a ticket";
    case "ticket.note": return "Added a private note to a ticket";
    case "ticket.reply": return "Emailed a reply to a ticket";
    case "output.reset": return `Removed the shared ${text("kind")} copy${text("reason") ? `: ${text("reason")}` : ""}`;
    case "staff.grant": return `Made ${text("email") || "someone"} ${ROLE_LABEL[text("role")] ?? text("role")}`;
    case "staff.role": return `Changed a role from ${ROLE_LABEL[text("from")] ?? text("from")} to ${ROLE_LABEL[text("to")] ?? text("to")}`;
    case "staff.remove": return `Removed a ${ROLE_LABEL[text("role")] ?? "staff"} role`;
    default: return action;
  }
}

export function hasPermission(permissions: string[] | undefined, permission: string): boolean {
  return !!permissions && permissions.includes(permission);
}

/** The admin screens a person's permissions allow, in the order shown. */
export interface AdminSection { href: string; label: string; needs: string }
export const SECTIONS: AdminSection[] = [
  { href: "/admin", label: "Overview", needs: "overview.view" },
  { href: "/admin/support", label: "Support", needs: "tickets.view" },
  { href: "/admin/users", label: "Users", needs: "users.view" },
  { href: "/admin/videos", label: "Videos", needs: "videos.view" },
  { href: "/admin/staff", label: "Staff", needs: "staff.view" },
  { href: "/admin/audit", label: "Audit log", needs: "audit.view" },
];

export function sectionsFor(permissions: string[] | undefined): AdminSection[] {
  return SECTIONS.filter((s) => hasPermission(permissions, s.needs));
}
