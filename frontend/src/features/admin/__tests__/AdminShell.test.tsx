// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let staff: Record<string, unknown> = {};
let pathname = "/admin";
vi.mock("../useStaff", () => ({ useStaff: () => staff }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("../../../components/Navbar", () => ({ Navbar: () => <header>navbar</header> }));
vi.mock("../../../lib/useTheme", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
vi.mock("../../auth/RequireAuth", () => ({ RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { AdminShell } from "../AdminShell";

const SUB = ["overview.view", "tickets.view", "tickets.manage", "users.view", "videos.view", "outputs.reset"];
const ADMIN = [...SUB, "system.view", "users.pii", "users.suspend", "users.limits", "staff.view", "staff.manage", "audit.view"];
const state = (over: Record<string, unknown>) => ({ loading: false, isStaff: true, role: "admin", permissions: ADMIN, userId: "u1", can: (p: string) => (over.permissions as string[] ?? ADMIN).includes(p), ...over });

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  pathname = "/admin";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = async () => { await act(async () => root.render(<AdminShell><p>secret panel</p></AdminShell>)); };

describe("AdminShell", () => {
  it("shows a plain not-found page, never the panel, to people who are not staff", async () => {
    staff = state({ isStaff: false, permissions: [] });
    await render();
    expect(container.textContent).toContain("This page could not be found.");
    expect(container.textContent).not.toContain("secret panel");
    expect(container.textContent).not.toContain("Admin");
  });

  it("waits while it finds out", async () => {
    staff = state({ loading: true, isStaff: false, permissions: [] });
    await render();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).not.toContain("secret panel");
  });

  it("gives an admin every section", async () => {
    staff = state({});
    await render();
    const tabs = [...container.querySelectorAll("nav a")].map((a) => a.textContent);
    expect(tabs).toEqual(["Overview", "Support", "Users", "Videos", "Staff", "Audit log"]);
    expect(container.textContent).toContain("secret panel");
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Overview");
  });

  it("gives a sub-admin only the support sections and treats the others as missing pages", async () => {
    staff = state({ role: "sub_admin", permissions: SUB });
    await render();
    expect([...container.querySelectorAll("nav a")].map((a) => a.textContent)).toEqual(["Overview", "Support", "Users", "Videos"]);
    expect(container.textContent).toContain("Sub-admin");

    pathname = "/admin/staff";
    await render();
    expect(container.textContent).toContain("This page could not be found.");
    expect(container.textContent).not.toContain("secret panel");
  });

  it("marks the section that is open", async () => {
    staff = state({});
    pathname = "/admin/users/abc";
    await render();
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe("Users");
  });
});
