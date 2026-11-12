import { describe, expect, it } from "vitest";
import { displayTitle, formatAdded, formatDuration, statusLabel } from "../format";

describe("library formatting", () => {
  it.each([
    [0, ""],
    [-5, ""],
    [59, "0:59"],
    [125, "2:05"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
  ])("formats %s seconds", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("labels each status", () => {
    expect(statusLabel("ready")).toBe("Ready");
    expect(statusLabel("failed")).toBe("Failed");
    expect(statusLabel("processing")).toBe("Processing");
    expect(statusLabel("pending")).toBe("Queued");
  });

  it("shows a helpful title while a video has none", () => {
    expect(displayTitle({ title: "Lecture", status: "ready" })).toBe("Lecture");
    expect(displayTitle({ title: null, status: "pending" })).toBe("Processing video…");
    expect(displayTitle({ title: null, status: "failed" })).toBe("Video could not be processed");
  });

  it("describes when a video was added", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(formatAdded("2026-11-10T01:00:00Z", now)).toBe("Today");
    expect(formatAdded("2026-11-09T11:00:00Z", now)).toBe("Yesterday");
    expect(formatAdded("2026-11-07T12:00:00Z", now)).toBe("3 days ago");
    expect(formatAdded("2026-09-01T12:00:00Z", now)).toMatch(/2026/);
    expect(formatAdded("nonsense", now)).toBe("");
  });
});
