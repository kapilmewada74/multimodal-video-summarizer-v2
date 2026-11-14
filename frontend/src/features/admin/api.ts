import { apiFetch, readError } from "../../lib/api";

/** Calls the admin API and returns its JSON. Throws an Error with a message that can be shown to the person. */
export async function adminCall<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(`/api/admin${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res, "That did not work. Please try again."));
  return (await res.json()) as T;
}

export const adminGet = <T,>(path: string) => adminCall<T>("GET", path);

export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export interface StaffInfo {
  is_staff: boolean;
  role?: "admin" | "sub_admin";
  email?: string | null;
  permissions?: string[];
}

export interface Paged<T> {
  total: number;
  items: T[];
}

export interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  guest: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  daily_video_limit: number;
  suspended: boolean;
  videos: number;
  role: "admin" | "sub_admin" | null;
}

export interface UserDetail extends UserRow {
  suspended_reason: string | null;
  usage: { jobs_total: number; jobs_failed_7d: number; generations_today: number; documents: number; document_bytes: number };
  recent_jobs: { id: string; status: string; source: string; error_kind: string | null; error: string | null; created_at: string | null }[];
  tickets: { id: string; subject: string; status: string; created_at: string | null }[];
}

export type TicketStatus = "open" | "in_progress" | "resolved" | "spam";

export interface TicketRow {
  id: string;
  subject: string;
  category: string;
  status: TicketStatus;
  name: string | null;
  email: string | null;
  has_account: boolean;
  assigned_to: string | null;
  assigned_to_email: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TicketList extends Paged<TicketRow> {
  counts: Record<TicketStatus, number>;
}

export interface TicketDetail extends TicketRow {
  message: string;
  user_id: string | null;
  events: { id: number; kind: "note" | "reply" | "status" | "assign"; body: string | null; by: string | null; created_at: string | null }[];
}

export interface VideoRow {
  id: string;
  title: string | null;
  source: string;
  youtube_id: string | null;
  status: string;
  duration_seconds: number | null;
  created_at: string | null;
  users: number;
  outputs: string[];
}

export interface VideoDetail extends VideoRow {
  shared_outputs: { kind: string; variant: string; created_at: string | null }[];
  personal_copies: Record<string, number>;
}

export interface StaffMember {
  id: string;
  email: string;
  role: "admin" | "sub_admin";
  granted_by: string | null;
  created_at: string | null;
  permissions: string[];
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string | null;
  role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
}

export interface Overview {
  users: { accounts: number; guests: number; new_24h: number; new_7d: number; suspended: number };
  activity: { videos_total: number; jobs_24h: number; active_24h: number; generations_today: number };
  support: { open: number; in_progress: number; oldest_open_seconds: number };
  system: null | {
    queue: { waiting: number; retrying: number; processing: number; oldest_waiting_seconds: number };
    last_24h: { completed: number; failed: number; failed_system: number; avg_processing_seconds: number; p95_processing_seconds: number };
  };
  alerts: string[] | null;
}
