import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("API calls", () => {
  it("never call our /api endpoints with a bare fetch (they would be sent without a session token)", () => {
    const offenders = sourceFiles(join(__dirname, "..", "..")).filter((file) => {
      if (file.endsWith(join("lib", "api.ts"))) return false;
      return /\bfetch\(\s*[`"']\/api\//.test(readFileSync(file, "utf8"));
    });
    expect(offenders).toEqual([]);
  });
});
