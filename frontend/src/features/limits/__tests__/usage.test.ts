import { describe, expect, it } from "vitest";
import { formatReset, formatUsage } from "../usage";

describe("usage text", () => {
  it("formats the daily count", () => {
    expect(formatUsage({ used: 7, limit: 10, remaining: 3, resets_at: "" })).toBe("7 of 10 videos today");
  });

  it("says when it is the free try-out", () => {
    expect(formatUsage({ used: 1, limit: 2, remaining: 1, resets_at: "", guest: true })).toBe("Free try-out: 1 of 2 videos today");
  });

  const now = new Date("2026-11-10T10:00:00Z");
  it.each([
    ["2026-11-10T10:30:00Z", "Resets in 30 min"],
    ["2026-11-10T10:00:30Z", "Resets in 1 min"],
    ["2026-11-10T13:15:00Z", "Resets in 3 h 15 min"],
    ["2026-11-10T09:00:00Z", "Resets soon"],
    ["not a date", "Resets soon"],
  ])("formats the reset time %s", (resetsAt, expected) => {
    expect(formatReset(resetsAt, now)).toBe(expected);
  });
});
