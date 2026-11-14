import type { Metadata } from "next";
import { AdminShell } from "../../features/admin/AdminShell";

// Never listed by search engines, never cached.
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
