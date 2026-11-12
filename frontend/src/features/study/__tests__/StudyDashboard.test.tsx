// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiFetch = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  readError: async (_r: Response, f = "x") => f,
}));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ ready: true, signedIn: true, configured: true }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { StudyDashboard } from "../StudyDashboard";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const dayList = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date("2026-11-11T12:00:00");
  d.setDate(d.getDate() - (n - 1 - i));
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { day: iso, seconds: i % 3 === 0 ? 0 : 900, videos_done: 0, quizzes_taken: 0, pomodoros: i === n - 1 ? 2 : 0 };
});
const overview = (over = {}) => ({
  credited: 0, today: { seconds: 900, videos_done: 1, quizzes_taken: 0, pomodoros: 2 }, goals: [],
  streak: { current: 4, longest: 9, today_done: true, min_seconds: 600, freeze_available: true, at_risk: false, frozen_days: [] },
  week: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"].map((day, i) => ({
    day, seconds: i === 0 ? 900 : i === 1 ? 0 : i === 2 ? 900 : 0, counted: i !== 1 && i < 3, frozen: i === 1, is_today: i === 2, future: i > 2,
  })),
  days: dayList(84), ...over,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  apiFetch.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = async (routes: Record<string, unknown> = {}) => {
  apiFetch.mockImplementation(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (key) return routes[key] instanceof Response ? routes[key] : json(routes[key]);
    if (url.startsWith("/api/study/overview")) return json(overview());
    if (url.startsWith("/api/study/videos")) return json({ items: [{ video_id: "v1", title: "Gradient Descent", seconds: 5400, sessions: 3 }, { video_id: "v2", title: "Linear Algebra", seconds: 1800, sessions: 1 }] });
    if (url.startsWith("/api/study/sessions")) return json({ items: [{ id: "s1", video_id: "v1", title: "Gradient Descent", started_at: "2026-11-11T08:00:00Z", seconds: 1500, pomodoros: 1 }, { id: "s2", video_id: null, title: null, started_at: "2026-11-10T08:00:00Z", seconds: 90, pomodoros: 0 }] });
    return json({});
  });
  await act(async () => root.render(<StudyDashboard onToast={() => {}} />));
  await act(async () => {});
};
const section = (label: string) => container.querySelector(`section[aria-label="${label}"]`) as HTMLElement;

describe("StudyDashboard", () => {
  it("asks for 12 weeks of days so the activity grid can be drawn", async () => {
    await mount();
    expect(apiFetch.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["/api/study/overview?days=84"]));
  });

  it("shows the streak with its forgiven-day status, and pomodoros today", async () => {
    await mount();
    expect(section("Streak").textContent).toContain("4 days");
    expect(section("Streak").textContent).toContain("One missed day is forgiven this week.");
    expect(section("Today").textContent).toContain("2 focus blocks");
  });

  it("says when the streak is at risk and when this week's forgiven day is used", async () => {
    await mount({ "/api/study/overview": overview({ streak: { current: 4, longest: 9, today_done: false, min_seconds: 600, freeze_available: false, at_risk: true, frozen_days: ["2026-11-10"] }, today: { seconds: 0, videos_done: 0, quizzes_taken: 0, pomodoros: 0 } }) });
    expect(section("Streak").textContent).toContain("at risk");
    expect(section("Streak").textContent).toContain("This week's forgiven day is used.");
  });

  it("draws the week with counted, forgiven, today and coming days", async () => {
    await mount();
    const week = section("This week");
    expect(week.textContent).toContain("2 of 7 days counted");
    const labels = [...week.querySelectorAll("li")].map((li) => li.getAttribute("aria-label")!);
    expect(labels).toHaveLength(7);
    expect(labels.map((l) => l.split(": ")[1].split(",")[0])).toEqual(["counted", "forgiven", "counted", "later", "later", "later", "later"]);
  });

  it("draws 12 weeks of activity, 7 rows each, with levels", async () => {
    await mount();
    const cells = [...container.querySelectorAll<HTMLElement>("[data-testid=heat-cell]")];
    expect(cells).toHaveLength(84);
    expect(cells.some((c) => c.dataset.level === "0")).toBe(true);
    expect(cells.some((c) => Number(c.dataset.level) >= 2)).toBe(true);
    expect(section("Study activity").textContent).toContain("last 30 days");
  });

  it("lists where the time went with links, and recent sessions", async () => {
    await mount();
    const where = section("Where your time went");
    expect(where.textContent).toContain("1 h 30 min");
    expect(where.querySelector("a")!.getAttribute("href")).toBe("/video/v1");
    const recent = section("Recent sessions");
    expect(recent.textContent).toContain("Gradient Descent");
    expect(recent.textContent).toContain("Study session");          // a session without a video
    expect(recent.textContent).toContain("25 min");
    expect(recent.textContent).toContain("1 focus block");
  });

  it("still works if the extra lists cannot be loaded", async () => {
    await mount({ "/api/study/videos": new Response("no", { status: 500 }), "/api/study/sessions": new Response("no", { status: 500 }) });
    expect(section("Streak")).not.toBeNull();
    expect(section("Where your time went")).toBeNull();
    expect(section("Recent sessions")).toBeNull();
  });

  it("works with an older server that does not send the week", async () => {
    const old = overview();
    delete (old as Partial<typeof old>).week;
    await mount({ "/api/study/overview": old });
    expect(section("This week")).toBeNull();
    expect(section("Streak")).not.toBeNull();
  });
});
