import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "../features/auth/AuthProvider";
import { SITE } from "../lib/site";

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const DESCRIPTION =
  "AI-powered video summarizer that generates structured study notes, complete transcripts, flashcards, slide presentations, and interactive quizzes.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: "SUMMARIZE.AI — Multimodal Video Summarizer", template: "%s · SUMMARIZE.AI" },
  description: DESCRIPTION,
  applicationName: SITE.name,
  openGraph: { type: "website", siteName: SITE.name, title: "SUMMARIZE.AI — Turn any video into study material", description: DESCRIPTION, url: SITE.url },
  twitter: { card: "summary", title: "SUMMARIZE.AI", description: DESCRIPTION },
};

// Fit the screen width, and keep pinch-zoom available (never block it: it is an accessibility feature).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        {SITE.analyticsDomain && (
          <script defer data-domain={SITE.analyticsDomain} src={`${SITE.analyticsHost}/js/script.tagged-events.js`} />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const observer = new MutationObserver(function(mutations) {
                  for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];
                    if (m.type === 'attributes') {
                      const name = m.attributeName;
                      if (name === 'bis_skin_checked' || name === 'bis_register' || (name && name.indexOf('__processed_') === 0)) {
                        m.target.removeAttribute(name);
                      }
                    }
                  }
                });
                observer.observe(document.documentElement, {
                  attributes: true,
                  subtree: true,
                  attributeFilter: ['bis_skin_checked', 'bis_register']
                });
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className={`${ibmPlexSans.variable} antialiased`} suppressHydrationWarning>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
