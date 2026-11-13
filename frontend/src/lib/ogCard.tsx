import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
const LIME = "#D9EC95";
const BLACK = "#0A0A0A";
const TEXT = "#F2F2F2";
const MUTED = "#A3A3A3";

interface CardOptions {
  /** Small label above the title, for example "SHARED STUDY NOTES". */
  kicker: string;
  title: string;
  subtitle?: string;
  chips: string[];
  /** A picture (data address) shown on the right, such as the video thumbnail. */
  thumbnail?: string | null;
  footer: string;
}

function Mark({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: size * 0.28, background: LIME }}>
      <svg width={size * 0.42} height={size * 0.42} viewBox="0 0 24 24">
        <path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z" fill={BLACK} />
      </svg>
    </div>
  );
}

/** The share-card picture (1200x630, our dark theme with the lime accent). Used for the site and for each shared summary. */
export function renderOgCard({ kicker, title, subtitle, chips, thumbnail, footer }: CardOptions): ImageResponse {
  const titleSize = title.length > 70 ? 50 : title.length > 40 ? 60 : 72;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: BLACK, padding: "56px 64px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Mark size={56} />
            <div style={{ display: "flex", marginLeft: 16, fontSize: 34, fontWeight: 800, color: TEXT, letterSpacing: -0.5 }}>
              SUMMARIZE<span style={{ color: LIME }}>.AI</span>
            </div>
          </div>
          <div style={{ display: "flex", padding: "8px 18px", border: `2px solid ${LIME}`, borderRadius: 999, color: LIME, fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>
            {kicker}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: thumbnail ? 48 : 0 }}>
            <div style={{ display: "flex", fontSize: titleSize, fontWeight: 800, color: TEXT, lineHeight: 1.08, letterSpacing: -1.5 }}>{title}</div>
            {subtitle ? <div style={{ display: "flex", marginTop: 22, fontSize: 28, color: MUTED, lineHeight: 1.35 }}>{subtitle}</div> : null}
          </div>
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} width={400} height={225} alt="" style={{ borderRadius: 24, border: "2px solid #2A2A2A", objectFit: "cover" }} />
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex" }}>
            {chips.map((chip) => (
              <div key={chip} style={{ display: "flex", marginRight: 12, padding: "9px 20px", border: "2px solid #2E2E2E", borderRadius: 999, color: TEXT, fontSize: 22, fontWeight: 700 }}>
                {chip}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", fontSize: 22, color: MUTED }}>{footer}</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, headers: { "Cache-Control": "public, max-age=600, s-maxage=600" } },
  );
}

/** The video's picture as a data address (an image the card can always draw). Null if it cannot be fetched quickly. */
export async function fetchThumbnail(youtubeId: string | null | undefined): Promise<string | null> {
  if (!youtubeId || !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return null;
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length < 400_000 ? `data:image/jpeg;base64,${bytes.toString("base64")}` : null;
  } catch {
    return null;
  }
}
