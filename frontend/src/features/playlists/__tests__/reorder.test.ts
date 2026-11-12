// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { arrayMove, neighboursAfterMove } from "../reorder";

const ids = ["a", "b", "c", "d", "e"];

describe("drag and drop neighbours", () => {
  it("moving down: the item lands between the two it passed", () => {
    expect(neighboursAfterMove(ids, 0, 2)).toEqual({ after: "c", before: "d" }); // a goes after c: b c a d e
  });
  it("moving up", () => {
    expect(neighboursAfterMove(ids, 3, 1)).toEqual({ after: "a", before: "b" }); // d goes after a: a d b c e
  });
  it("to the front", () => {
    expect(neighboursAfterMove(ids, 4, 0)).toEqual({ after: null, before: "a" });
  });
  it("to the end", () => {
    expect(neighboursAfterMove(ids, 0, 4)).toEqual({ after: "e", before: null });
  });
  it("a one-item list", () => {
    expect(neighboursAfterMove(["x"], 0, 0)).toEqual({ after: null, before: null });
  });
  it("does not change the input", () => {
    const copy = [...ids];
    neighboursAfterMove(copy, 1, 3);
    arrayMove(copy, 1, 3);
    expect(copy).toEqual(ids);
  });
  it("arrayMove agrees with the neighbours", () => {
    const moved = arrayMove(ids, 1, 3);
    expect(moved).toEqual(["a", "c", "d", "b", "e"]);
    const n = neighboursAfterMove(ids, 1, 3);
    expect(moved[moved.indexOf("b") - 1]).toBe(n.after);
    expect(moved[moved.indexOf("b") + 1]).toBe(n.before);
  });
});
