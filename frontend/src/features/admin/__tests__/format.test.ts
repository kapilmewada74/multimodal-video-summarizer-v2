import { describe, expect, it } from "vitest";
import { ago, describeAction, hasPermission, sectionsFor, waiting } from "../format";
import { query } from "../api";

const NOW = new Date("2026-11-15T12:00:00Z").getTime();

describe("ago", () => {
  it("says how long ago in the largest sensible unit", () => {
    expect(ago("2026-11-15T11:59:50Z", NOW)).toBe("just now");
    expect(ago("2026-11-15T11:30:00Z", NOW)).toBe("30 min ago");
    expect(ago("2026-11-15T07:00:00Z", NOW)).toBe("5 h ago");
    expect(ago("2026-11-12T12:00:00Z", NOW)).toBe("3 d ago");
    expect(ago("2026-08-15T12:00:00Z", NOW)).toBe("3 mo ago");
  });
  it("handles a missing date and a clock slightly ahead", () => {
    expect(ago(null, NOW)).toBe("never");
    expect(ago("2026-11-15T12:00:30Z", NOW)).toBe("just now");
  });
});

describe("waiting", () => {
  it("rounds down to a readable wait", () => {
    expect(waiting(0)).toBe("under a minute");
    expect(waiting(125)).toBe("2 min");
    expect(waiting(7300)).toBe("2 h");
    expect(waiting(200000)).toBe("2 d");
  });
});

describe("describeAction", () => {
  it("turns audit entries into sentences", () => {
    expect(describeAction("user.suspend", { reason: "spam" })).toBe("Suspended an account: spam");
    expect(describeAction("user.limit", { from: 10, to: 25 })).toBe("Changed a daily allowance from 10 to 25");
    expect(describeAction("ticket.status", { from: "open", to: "resolved" })).toBe("Moved a ticket from Open to Resolved");
    expect(describeAction("staff.grant", { email: "a@b.co", role: "sub_admin" })).toBe("Made a@b.co Sub-admin");
    expect(describeAction("output.reset", { kind: "quiz", reason: "wrong" })).toBe("Removed the shared quiz copy: wrong");
    expect(describeAction("ticket.assign", { to: null })).toBe("Released a ticket");
  });
  it("never shows nothing for an action it does not know", () => {
    expect(describeAction("something.new")).toBe("something.new");
  });
});

describe("what each role sees", () => {
  const sub = ["overview.view", "tickets.view", "tickets.manage", "users.view", "videos.view", "outputs.reset"];
  const admin = [...sub, "system.view", "users.pii", "users.suspend", "users.limits", "staff.view", "staff.manage", "audit.view"];
  it("sub-admins get the support screens only", () => {
    expect(sectionsFor(sub).map((s) => s.label)).toEqual(["Overview", "Support", "Users", "Videos"]);
  });
  it("admins get everything", () => {
    expect(sectionsFor(admin).map((s) => s.label)).toEqual(["Overview", "Support", "Users", "Videos", "Staff", "Audit log"]);
  });
  it("no permissions, no screens", () => {
    expect(sectionsFor(undefined)).toEqual([]);
    expect(hasPermission([], "users.view")).toBe(false);
  });
});

describe("query", () => {
  it("leaves out empty values and encodes the rest", () => {
    expect(query({ q: "a b&c", status: "", mine: false, offset: 0, limit: 25 })).toBe("?q=a+b%26c&offset=0&limit=25");
    expect(query({ q: "" })).toBe("");
  });
});
