import { describe, expect, it } from "vitest";
import type { Slide } from "../../../components/PresentationView";
import { MAX_BULLETS, MAX_SLIDES, addBullet, addSlide, blankSlide, moveSlide, removeBullet, removeSlide, setBullet, slideProblems, updateSlide } from "../slides";

const s = (title: string, bullets: string[] = ["a"]): Slide => ({ title, bullets });
const titles = (list: Slide[]) => list.map((x) => x.title);

describe("slide helpers", () => {
  it("adds after the chosen slide or at the end", () => {
    const list = [s("1"), s("2"), s("3")];
    expect(titles(addSlide(list, 0))).toEqual(["1", "New slide", "2", "3"]);
    expect(titles(addSlide(list))).toEqual(["1", "2", "3", "New slide"]);
  });

  it("stops adding at the limit", () => {
    const full = Array.from({ length: MAX_SLIDES }, (_, i) => s(String(i)));
    expect(addSlide(full)).toBe(full);
  });

  it("never removes the last slide", () => {
    expect(removeSlide([s("only")], 0)).toHaveLength(1);
    expect(titles(removeSlide([s("1"), s("2")], 0))).toEqual(["2"]);
    expect(removeSlide([s("1"), s("2")], 5)).toHaveLength(2);
  });

  it("moves slides and ignores impossible moves", () => {
    const list = [s("1"), s("2"), s("3")];
    expect(titles(moveSlide(list, 0, 2))).toEqual(["2", "3", "1"]);
    expect(moveSlide(list, 1, 1)).toBe(list);
    expect(moveSlide(list, 0, 3)).toBe(list);
    expect(titles(list)).toEqual(["1", "2", "3"]); // original untouched
  });

  it("updates one slide without touching the others", () => {
    const list = [s("1"), s("2")];
    const next = updateSlide(list, 1, { title: "Two" });
    expect(titles(next)).toEqual(["1", "Two"]);
    expect(next[0]).toBe(list[0]);
  });

  it("edits bullets, up to the limit", () => {
    let slide = s("x", ["a", "b"]);
    expect(setBullet(slide, 1, "B").bullets).toEqual(["a", "B"]);
    expect(removeBullet(slide, 0).bullets).toEqual(["b"]);
    for (let i = 0; i < 20; i++) slide = addBullet(slide);
    expect(slide.bullets).toHaveLength(MAX_BULLETS);
  });

  it("reports slides without a title", () => {
    expect(slideProblems([s("ok"), s("  ")])).toEqual(["Slide 2 needs a title."]);
    expect(slideProblems([s("ok")])).toEqual([]);
    expect(blankSlide().title).toBe("New slide");
  });
});
