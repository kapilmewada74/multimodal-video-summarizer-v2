import { describe, expect, it } from "vitest";
import { validateContact } from "../contact";

const ok = { name: "", email: "ada@example.org", category: "general", subject: "", message: "Hello, I need some help please." };

describe("validateContact", () => {
  it("accepts a normal message", () => {
    expect(validateContact(ok)).toEqual({});
  });
  it("needs a real email address", () => {
    for (const email of ["", "ada", "ada@", "a b@example.org", "ada@example", "<x>@example.org"]) {
      expect(validateContact({ ...ok, email }).email, email).toBeTruthy();
    }
    expect(validateContact({ ...ok, email: "  ada@example.org " })).toEqual({});
  });
  it("needs a message that is long enough but not huge", () => {
    expect(validateContact({ ...ok, message: "short" }).message).toMatch(/at least 10/);
    expect(validateContact({ ...ok, message: "x".repeat(4001) }).message).toMatch(/under 4000/);
    expect(validateContact({ ...ok, message: "          x " }).message).toBeTruthy();
  });
});
