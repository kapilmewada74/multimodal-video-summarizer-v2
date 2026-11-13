import { fetchThumbnail, OG_SIZE, renderOgCard } from "../../../lib/ogCard";
import { clampTitle, fetchPublicShare, isLatinTitle } from "../../../lib/publicShare";
import { SITE } from "../../../lib/site";

export const alt = "Shared study notes on SUMMARIZE.AI";
export const size = OG_SIZE;
export const contentType = "image/png";

/** The picture shown when a share link is pasted into WhatsApp, Telegram, Slack, X and so on. */
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const video = await fetchPublicShare(token);
  const footer = SITE.url.replace(/^https?:\/\//, "");
  if (!video) {
    return renderOgCard({ kicker: "STUDY NOTES", title: "Study notes made with SUMMARIZE.AI", chips: ["Summary", "Mind map", "Flashcards"], footer });
  }
  const chips = ["Summary", ...(video.mindmap ? ["Mind map"] : []), ...(video.flashcards?.length ? [`${video.flashcards.length} flashcards`] : [])];
  // The built-in card font draws Latin letters only; for other scripts the real title is still in the link's text.
  const readable = video.title && isLatinTitle(video.title);
  return renderOgCard({
    kicker: "SHARED STUDY NOTES",
    title: readable ? clampTitle(video.title as string) : "Shared study notes",
    chips,
    thumbnail: await fetchThumbnail(video.youtube_id),
    footer,
  });
}
