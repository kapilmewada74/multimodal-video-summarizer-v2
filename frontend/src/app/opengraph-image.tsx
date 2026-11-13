import { renderOgCard, OG_SIZE } from "../lib/ogCard";
import { SITE } from "../lib/site";

export const alt = "SUMMARIZE.AI: turn any video into study material";
export const size = OG_SIZE;
export const contentType = "image/png";

/** The picture shown when the site itself is shared. */
export default function Image() {
  return renderOgCard({
    kicker: "STUDY SMARTER",
    title: "Turn any video into study material",
    subtitle: "Paste a link. Get notes, flashcards, a mind map, slides and a quiz in seconds.",
    chips: ["Summary", "Flashcards", "Mind map", "Slides", "Quiz"],
    footer: SITE.url.replace(/^https?:\/\//, ""),
  });
}
