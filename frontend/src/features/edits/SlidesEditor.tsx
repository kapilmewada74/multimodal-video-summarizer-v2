"use client";

import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { PresentationData, Slide } from "../../components/PresentationView";
import { EditHistory } from "./EditHistory";
import { SaveIndicator } from "./SaveStatus";
import {
  MAX_BULLETS, MAX_SLIDES, addBullet, addSlide, moveSlide, removeBullet, removeSlide, setBullet, slideProblems, updateSlide,
} from "./slides";
import type { UseEdit } from "./useEdit";

const LAYOUTS: Array<{ value: NonNullable<Slide["layout"]>; label: string }> = [
  { value: "split_left_image", label: "Image on the left" },
  { value: "split_right_image", label: "Image on the right" },
  { value: "cards_right", label: "Cards on the right" },
];

const field =
  "w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-app)] px-3 py-2 text-sm text-[var(--text-main)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]";

interface Props {
  /** The AI slides, shown until you change something. */
  ai: PresentationData;
  state: UseEdit<PresentationData>;
  onDone: () => void;
  onToast: (msg: string, type?: "success" | "info" | "error") => void;
}

/** Form editor for slides: titles, bullets, speaker notes, order. The preview and the PPTX export use the same data. */
export function SlidesEditor({ ai, state, onDone, onToast }: Props) {
  // The draft may briefly hold something that cannot be saved yet (a slide with no title).
  const [data, setData] = useState<PresentationData>(state.edit ?? ai);
  useEffect(() => setData(state.edit ?? ai), [state.edit, ai]);
  const [selected, setSelected] = useState(0);
  const slides = data.slides;
  const index = Math.min(selected, slides.length - 1);
  const slide = slides[index];
  const problems = slideProblems(slides);

  const commit = (next: Slide[], nextSelected = index) => {
    const updated = { ...data, slides: next };
    setData(updated);
    setSelected(Math.max(0, Math.min(nextSelected, next.length - 1)));
    if (slideProblems(next).length === 0) state.change(updated); // never save something the server would refuse
  };
  const patch = (p: Partial<Slide>) => commit(updateSlide(slides, index, p));

  const apply = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      onToast(message, "success");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Something went wrong.", "error");
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-[var(--card-border)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <SaveIndicator status={state.status} conflict={state.conflict} />
        <div className="flex flex-wrap items-center gap-2">
          <EditHistory
            versions={state.versions}
            hasEdit={state.edit !== null}
            onRestore={(id) => apply(() => state.restore(id), "Version restored.")}
            onReset={() => apply(() => state.reset(), "Back to the AI version.")}
          />
          <button
            type="button"
            onClick={() => void state.flush().then(onDone)}
            className="rounded-full bg-[var(--brand-lime)] px-4 py-1.5 text-xs font-black text-[#0E0F0C] active:scale-95"
          >
            Done
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <nav aria-label="Slides" className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              aria-current={i === index}
              className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs font-bold md:shrink ${
                i === index
                  ? "border-[var(--brand-lime)] bg-[var(--btn-secondary-bg)] text-[var(--text-main)]"
                  : "border-[var(--card-border)] text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)]"
              }`}
            >
              <span className="mr-1.5 text-[var(--text-muted)]">{i + 1}.</span>
              {s.title || "Untitled"}
            </button>
          ))}
          <button
            type="button"
            disabled={slides.length >= MAX_SLIDES}
            onClick={() => commit(addSlide(slides, index), index + 1)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--card-border)] px-3 py-2 text-xs font-bold text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add slide
          </button>
        </nav>

        {slide && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-black text-[var(--text-main)]">Slide {index + 1} of {slides.length}</h4>
              <div className="flex items-center gap-1.5">
                <button type="button" aria-label="Move slide up" disabled={index === 0}
                  onClick={() => commit(moveSlide(slides, index, index - 1), index - 1)}
                  className="rounded-lg border border-[var(--card-border)] p-1.5 disabled:opacity-40"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Move slide down" disabled={index === slides.length - 1}
                  onClick={() => commit(moveSlide(slides, index, index + 1), index + 1)}
                  className="rounded-lg border border-[var(--card-border)] p-1.5 disabled:opacity-40"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Delete slide" disabled={slides.length <= 1}
                  onClick={() => commit(removeSlide(slides, index), index)}
                  className="rounded-lg border border-[var(--card-border)] p-1.5 text-[var(--color-danger)] disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>

            <label className="block text-xs font-bold text-[var(--text-muted)]">Title
              <input className={`${field} mt-1`} value={slide.title} maxLength={200} onChange={(e) => patch({ title: e.target.value })} />
            </label>
            <label className="block text-xs font-bold text-[var(--text-muted)]">Small heading above the title
              <input className={`${field} mt-1`} value={slide.kicker ?? ""} maxLength={200} onChange={(e) => patch({ kicker: e.target.value })} />
            </label>
            <label className="block text-xs font-bold text-[var(--text-muted)]">Summary
              <textarea className={`${field} mt-1 min-h-[72px]`} value={slide.summary ?? ""} maxLength={2000} onChange={(e) => patch({ summary: e.target.value })} />
            </label>

            <fieldset>
              <legend className="text-xs font-bold text-[var(--text-muted)]">Bullet points</legend>
              <ul className="mt-1 space-y-2">
                {slide.bullets.map((b, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input aria-label={`Bullet ${i + 1}`} className={field} value={b} maxLength={400}
                      onChange={(e) => patch(setBullet(slide, i, e.target.value))} />
                    <button type="button" aria-label={`Remove bullet ${i + 1}`}
                      onClick={() => patch(removeBullet(slide, i))}
                      className="rounded-lg border border-[var(--card-border)] p-1.5"><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
              <button type="button" disabled={slide.bullets.length >= MAX_BULLETS} onClick={() => patch(addBullet(slide))}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" /> Add bullet
              </button>
            </fieldset>

            <label className="block text-xs font-bold text-[var(--text-muted)]">Layout
              <select className={`${field} mt-1`} value={slide.layout ?? "split_left_image"}
                onChange={(e) => patch({ layout: e.target.value as Slide["layout"] })}>
                {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold text-[var(--text-muted)]">Speaker notes
              <textarea className={`${field} mt-1 min-h-[72px]`} value={slide.notes ?? ""} maxLength={2000} onChange={(e) => patch({ notes: e.target.value })} />
            </label>
          </div>
        )}
      </div>
      {problems.length > 0 && (
        <p role="alert" className="mt-3 text-xs font-bold text-[var(--color-danger)]">{problems[0]} Changes are saved once this is fixed.</p>
      )}
    </div>
  );
}
