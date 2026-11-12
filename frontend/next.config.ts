import type { NextConfig } from "next";
import path from "path";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy for the production build. Next.js needs inline scripts and styles for its own
 * bootstrapping, so those are allowed; everything else is limited to what the app really loads:
 * our own address, Supabase (sign-in, realtime, file links), the YouTube player and an optional Plausible script.
 */
function contentSecurityPolicy(): string {
  const supabase = (process.env.NEXT_PUBLIC_SUPABASE_URL || "https://*.supabase.co").replace(/\/$/, "");
  const supabaseSocket = supabase.replace(/^http/, "ws");
  const analytics = process.env.NEXT_PUBLIC_ANALYTICS_HOST || "https://plausible.io";
  const parts: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "https://www.youtube.com", "https://s.ytimg.com", analytics],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://i.ytimg.com", "https://*.googleusercontent.com", "https://*.supabase.co"],
    "media-src": ["'self'", "blob:", "https://*.supabase.co"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabase, supabaseSocket, analytics],
    "frame-src": ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://*.supabase.co"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(parts).map(([key, values]) => `${key} ${values.join(" ")}`).join("; ");
}

const nextConfig: NextConfig = {
  // A self-contained server (server.js + only the files it needs): a much smaller container image.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  poweredByHeader: false,
  async rewrites() {
    // Used in development, and as a fallback in production. In production the reverse proxy sends /api straight to the API.
    const backendUrl = process.env.BACKEND_API_URL || "http://127.0.0.1:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    const production = isProduction
      ? [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        ]
      : [];
    return [
      { source: "/:path*", headers: [...common, ...production] },
      // The push service worker must always be fetched fresh so an update is never stuck behind a cache.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
