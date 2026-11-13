import { describe, expect, it } from "vitest";
import { formatBytes, formatExtensions, formatSeconds, percent } from "../limits";

describe("limit text", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(formatBytes(500 * 1024 * 1024)).toBe("500 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });

  it("formats video lengths", () => {
    expect(formatSeconds(10800)).toBe("3 hours");
    expect(formatSeconds(3600)).toBe("1 hour");
    expect(formatSeconds(5400)).toBe("1 hour 30 minutes");
    expect(formatSeconds(90)).toBe("1 minute 30 seconds");
    expect(formatSeconds(45)).toBe("45 seconds");
    expect(formatSeconds(0)).toBe("0 seconds");
  });

  it("lists file types", () => {
    expect(formatExtensions([".mp4", ".mov", ".mkv"])).toBe("MP4, MOV and MKV");
    expect(formatExtensions([".pdf"])).toBe("PDF");
    expect(formatExtensions([])).toBe("");
  });

  it("computes how full something is", () => {
    expect(percent(5, 10)).toBe(50);
    expect(percent(0, 10)).toBe(0);
    expect(percent(12, 10)).toBe(100);
    expect(percent(1, 0)).toBe(100);
    expect(percent(0, 0)).toBe(0);
  });
});
