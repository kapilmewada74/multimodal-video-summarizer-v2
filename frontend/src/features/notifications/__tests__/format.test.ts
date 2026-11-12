import { describe, expect, it } from "vitest";
import { hourLabel, KIND_LABELS, timeAgo } from "../format";

describe("notification formatting", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  it.each([
    ["2026-11-10T11:59:30Z", "just now"],
    ["2026-11-10T11:55:00Z", "5 min ago"],
    ["2026-11-10T09:00:00Z", "3 h ago"],
    ["2026-11-09T12:00:00Z", "1 day ago"],
    ["2026-11-06T12:00:00Z", "4 days ago"],
    ["not a date", ""],
  ])("describes %s", (iso, text) => expect(timeAgo(iso, now)).toBe(text));

  it("falls back to a date for older items", () => expect(timeAgo("2026-09-01T12:00:00Z", now)).toMatch(/Sep|1/));

  it.each([[0, "12:00 AM"], [1, "1:00 AM"], [11, "11:00 AM"], [12, "12:00 PM"], [13, "1:00 PM"], [20, "8:00 PM"], [23, "11:00 PM"]])(
    "hour %s", (h, text) => expect(hourLabel(h)).toBe(text));

  it("has a label for every kind of notification the server sends", () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual(["goal_reached", "streak_at_risk", "streak_milestone", "summary_ready"]);
  });
});
