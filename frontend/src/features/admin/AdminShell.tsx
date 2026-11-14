"use client";

import React, { createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Navbar } from "../../components/Navbar";
import { useTheme } from "../../lib/useTheme";
import { RequireAuth } from "../auth/RequireAuth";
import { ROLE_LABEL, sectionsFor } from "./format";
import { Badge, Loading } from "./ui";
import { useStaff, type StaffState } from "./useStaff";

const StaffContext = createContext<StaffState | null>(null);

/** The signed-in staff member (only available inside the admin screens, which are only shown to staff). */
export function useStaffContext(): StaffState {
  const value = useContext(StaffContext);
  if (!value) throw new Error("useStaffContext must be used inside the admin panel");
  return value;
}

/** The same plain page a missing address shows, so the panel does not announce itself to people who are not staff. */
function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="text-5xl font-black">404</p>
      <p className="mt-3 text-sm text-[var(--text-muted)]">This page could not be found.</p>
      <Link href="/" className="mt-6 inline-flex font-bold underline">Back to the home page</Link>
    </div>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const staff = useStaff();
  const pathname = usePathname() ?? "/admin";
  if (staff.loading) return <Loading />;
  if (!staff.isStaff) return <NotFound />;

  const sections = sectionsFor(staff.permissions);
  const current = sections.find((s) => (s.href === "/admin" ? pathname === "/admin" : pathname.startsWith(s.href)));
  // A tab the person's role does not include behaves like a missing page, not like a permissions error.
  if (!current) return <NotFound />;

  return (
    <StaffContext.Provider value={staff}>
      <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-[var(--card-border)] pb-3">
        <span className="flex items-center gap-1.5 text-sm font-black"><ShieldCheck className="h-4 w-4" /> Admin</span>
        <Badge tone="brand">{ROLE_LABEL[staff.role ?? ""] ?? "Staff"}</Badge>
        <nav aria-label="Admin sections" className="-mb-px flex w-full gap-1 overflow-x-auto sm:ml-4 sm:w-auto">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={s === current ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${s === current ? "bg-[var(--btn-secondary-bg)] text-[var(--text-main)]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </StaffContext.Provider>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="min-h-screen bg-[var(--bg-app)] text-[var(--text-main)] transition-colors">
      <Navbar theme={theme} onToggleTheme={toggleTheme} />
      <main className="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6">
        <RequireAuth><Gate>{children}</Gate></RequireAuth>
      </main>
    </div>
  );
}
