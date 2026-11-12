import type { Slide } from "../../components/PresentationView";

export const MAX_SLIDES = 40;
export const MAX_BULLETS = 12;

export function blankSlide(): Slide {
  return {
    title: "New slide",
    kicker: "",
    summary: "",
    bullets: [""],
    layout: "split_left_image",
    image_asset: "",
    notes: "",
  };
}

export function addSlide(slides: Slide[], afterIndex?: number): Slide[] {
  if (slides.length >= MAX_SLIDES) return slides;
  const at = afterIndex === undefined ? slides.length : afterIndex + 1;
  return [...slides.slice(0, at), blankSlide(), ...slides.slice(at)];
}

/** Keeps at least one slide: a presentation cannot be empty. */
export function removeSlide(slides: Slide[], index: number): Slide[] {
  if (slides.length <= 1 || index < 0 || index >= slides.length) return slides;
  return slides.filter((_, i) => i !== index);
}

export function moveSlide(slides: Slide[], from: number, to: number): Slide[] {
  if (from === to || from < 0 || to < 0 || from >= slides.length || to >= slides.length) return slides;
  const next = [...slides];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function updateSlide(slides: Slide[], index: number, patch: Partial<Slide>): Slide[] {
  return slides.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

export function setBullet(slide: Slide, bulletIndex: number, text: string): Slide {
  return { ...slide, bullets: slide.bullets.map((b, i) => (i === bulletIndex ? text : b)) };
}

export function addBullet(slide: Slide): Slide {
  if (slide.bullets.length >= MAX_BULLETS) return slide;
  return { ...slide, bullets: [...slide.bullets, ""] };
}

export function removeBullet(slide: Slide, bulletIndex: number): Slide {
  return { ...slide, bullets: slide.bullets.filter((_, i) => i !== bulletIndex) };
}

/** Problems that would make the server refuse the save, in plain words. */
export function slideProblems(slides: Slide[]): string[] {
  const problems: string[] = [];
  slides.forEach((s, i) => {
    if (!s.title.trim()) problems.push(`Slide ${i + 1} needs a title.`);
  });
  return problems;
}
