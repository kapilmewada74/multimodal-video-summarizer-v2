import type { Metadata } from "next";
import { fetchPublicShare, plainExcerpt } from "../../../lib/publicShare";
import { SITE } from "../../../lib/site";
import { SharedView } from "./SharedView";

type Props = { params: Promise<{ token: string }> };

const FALLBACK = "Study notes made with SUMMARIZE.AI: summary, mind map and flashcards from a video.";

/** What a pasted link looks like in WhatsApp, Telegram, Slack, X and so on. The card image comes from opengraph-image.tsx. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const video = await fetchPublicShare(token);
  const robots = { index: false, follow: false };      // shared notes are for people who have the link, not for search engines
  if (!video) return { title: "Shared study notes", description: FALLBACK, robots };

  const title = video.title?.trim() || "Shared study notes";
  const description = plainExcerpt(video.summary, 180) || FALLBACK;
  return {
    title,
    description,
    robots,
    openGraph: { type: "article", siteName: SITE.name, title: `${title} · Study notes`, description, url: `/s/${token}` },
    twitter: { card: "summary_large_image", title: `${title} · Study notes`, description },
  };
}

export default function SharedPage() {
  return <SharedView />;
}
