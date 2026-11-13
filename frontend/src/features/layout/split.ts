/** The maths behind the resizable workspace. Kept free of React so it can be tested. */

export type Orientation = "row" | "column";          // row: side by side, column: stacked
export type OrientationChoice = "auto" | Orientation;
export type Collapsed = "first" | "second" | null;

export interface LayoutState {
  orientation: OrientationChoice;
  /** Share of the space given to the first pane (the video), between MIN and MAX. */
  fraction: number;
  collapsed: Collapsed;
}

export const DEFAULT_LAYOUT: LayoutState = { orientation: "auto", fraction: 0.42, collapsed: null };
export const MIN_FRACTION = 0.15;
export const MAX_FRACTION = 0.85;
export const KEY_STEP = 0.02;
/** Below this width the two panes are stacked (tablets in portrait, phones). */
export const SIDE_BY_SIDE_MIN_WIDTH = 1024;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Side by side when there is room, otherwise stacked; the person can force either on wide screens. */
export function resolveOrientation(choice: OrientationChoice, containerWidth: number): Orientation {
  if (containerWidth < SIDE_BY_SIDE_MIN_WIDTH) return "column"; // there is never room for two columns
  return choice === "auto" ? "row" : choice;
}

/**
 * The new share for the first pane while dragging.
 * `pointer` and `start` are screen positions along the split direction, `size` is the container length.
 * Each pane keeps at least `minPx` (when the container is big enough for both).
 */
export function fractionFromPointer(pointer: number, start: number, size: number, minPx = 160): number {
  if (!(size > 0)) return DEFAULT_LAYOUT.fraction;
  const minShare = Math.min(minPx / size, 0.5);
  const lower = Math.max(MIN_FRACTION, minShare);
  const upper = Math.min(MAX_FRACTION, 1 - minShare);
  return clamp((pointer - start) / size, lower, Math.max(lower, upper));
}

export function fractionFromKey(fraction: number, key: string, orientation: Orientation): number | null {
  const back = orientation === "row" ? "ArrowLeft" : "ArrowUp";
  const forward = orientation === "row" ? "ArrowRight" : "ArrowDown";
  if (key === back) return clamp(fraction - KEY_STEP, MIN_FRACTION, MAX_FRACTION);
  if (key === forward) return clamp(fraction + KEY_STEP, MIN_FRACTION, MAX_FRACTION);
  if (key === "Home") return MIN_FRACTION;
  if (key === "End") return MAX_FRACTION;
  return null;
}

/** The biggest rectangle with the given aspect ratio that fits inside width x height. */
export function fitAspect(width: number, height: number, ratio = 16 / 9): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const byWidth = { width, height: width / ratio };
  if (byWidth.height <= height) return { width: Math.floor(byWidth.width), height: Math.floor(byWidth.height) };
  return { width: Math.floor(height * ratio), height: Math.floor(height) };
}

/** Read a saved layout, ignoring anything that does not look right. */
export function parseLayout(raw: string | null | undefined): LayoutState {
  if (!raw) return { ...DEFAULT_LAYOUT };
  try {
    const data = JSON.parse(raw) as Partial<LayoutState>;
    // The Stacked button is gone: narrow screens stack on their own, wide ones are always side by side. Old choices are dropped.
    const orientation: OrientationChoice = "auto";
    const fraction =
      typeof data.fraction === "number" && Number.isFinite(data.fraction) ? clamp(data.fraction, MIN_FRACTION, MAX_FRACTION) : DEFAULT_LAYOUT.fraction;
    const collapsed: Collapsed = data.collapsed === "first" || data.collapsed === "second" ? data.collapsed : null;
    return { orientation, fraction, collapsed };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

export function isDefaultLayout(layout: LayoutState): boolean {
  return layout.orientation === DEFAULT_LAYOUT.orientation && layout.collapsed === null && Math.abs(layout.fraction - DEFAULT_LAYOUT.fraction) < 0.001;
}
