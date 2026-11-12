// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "../analytics";

afterEach(() => { delete (window as unknown as { plausible?: unknown }).plausible; });

describe("track", () => {
  it("does nothing when analytics is not configured", () => {
    expect(() => track("summary_submitted")).not.toThrow();
  });
  it("sends the event name and only the given properties", () => {
    const plausible = vi.fn();
    (window as unknown as { plausible: typeof plausible }).plausible = plausible;
    track("sign_in_started", { method: "google" });
    track("study_started");
    expect(plausible).toHaveBeenNthCalledWith(1, "sign_in_started", { props: { method: "google" } });
    expect(plausible).toHaveBeenNthCalledWith(2, "study_started", undefined);
  });
  it("never lets an analytics failure break the app", () => {
    (window as unknown as { plausible: () => void }).plausible = () => { throw new Error("blocked"); };
    expect(() => track("export_used")).not.toThrow();
  });
});
