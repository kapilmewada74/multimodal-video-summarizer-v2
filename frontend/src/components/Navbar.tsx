"use client";

import React, { useState, useEffect } from "react";
import { Sun, Moon, Menu, X, ArrowUpRight, Play } from "lucide-react";
import { Logo } from "./Logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountMenu } from "../features/auth/AccountMenu";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { useAuth } from "../features/auth/AuthProvider";

const ACCOUNT_LINKS: Array<[string, string]> = [["/library", "Library"], ["/playlists", "Playlists"], ["/study", "Study"]];

/**
 * Which top-bar link the current page belongs to, so the lime underline is always under the right one.
 * A finished summary is part of Home; a video's workspace is part of the Library.
 */
export function isActivePath(pathname: string, href: string): boolean {
  const within = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (href === "/") return pathname === "/" || within("/summary");
  if (href === "/library") return within("/library") || within("/video");
  return within(href);
}

/** One style for every top-bar link: the page you are on has the lime underline. */
const linkClass = (active: boolean) =>
  `whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] rounded-md px-1.5 py-0.5 border-b-2 ${
    active
      ? "text-[var(--text-main)] border-[var(--brand-lime)]"
      : "border-transparent hover:text-[var(--text-main)]"
  }`;

interface NavbarProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export function Navbar({ theme, onToggleTheme }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { configured, signedIn } = useAuth();
  const pathname = usePathname();
  const isHome = pathname === "/";
  const homeActive = isActivePath(pathname, "/");
  const showLibrary = configured && signedIn;

  // A new page always starts with the phone menu closed.
  useEffect(() => setMobileMenuOpen(false), [pathname]);

  // Close mobile menu on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Prevent background scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  return (
    <>
    {/* The bar is "fixed" (not "sticky"), so it stays on the screen no matter which ancestor has an overflow rule
        or which browser is used. This spacer keeps the page content from sliding under it. */}
    <div className="h-16 shrink-0" aria-hidden />
    <nav className="h-16 fixed inset-x-0 top-0 z-50 bg-[var(--card-bg)]/90 backdrop-blur-md border-b border-[var(--card-border)] px-4 sm:px-8 flex items-center justify-between transition-colors">
      <div className="w-full max-w-[2048px] mx-auto flex items-center justify-between">
        {/* Brand Logo & Name */}
        <Link
          href="/"
          onClick={(e) => {
            // Already on the home page: just glide back to the top instead of reloading it.
            if (isHome) {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          className="flex min-w-0 shrink items-center gap-2 sm:gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] rounded-lg p-1"
          aria-label="SUMMARIZE.AI home"
        >
          <span className="shrink-0"><Logo size={30} /></span>
          <span className="truncate font-extrabold text-sm sm:text-base tracking-tight uppercase text-[var(--text-main)]">
            SUMMARIZE<span className="text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]">.AI</span>
          </span>
        </Link>

        {/* Nav Links & Actions */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-4 lg:gap-8">
          {/* Desktop Navigation */}
          <div 
            className="hidden md:flex items-center gap-2 lg:gap-6 font-medium text-[var(--text-muted)]"
            style={{ 
              fontFamily: 'var(--font-ibm-plex-sans), "IBM Plex Sans", sans-serif', 
              fontSize: '15px',
              letterSpacing: '-0.01em'
            }}
          >
            <Link href="/" aria-current={homeActive ? "page" : undefined} className={linkClass(homeActive)}>
              Home
            </Link>
            {showLibrary &&
              ACCOUNT_LINKS.map(([href, label]) => {
                const active = isActivePath(pathname, href);
                return (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined} className={linkClass(active)}>
                    {label}
                  </Link>
                );
              })}
          </div>

          <NotificationBell />
          {/* "Sign in" for visitors, the person's picture (with a menu) once signed in. */}
          <AccountMenu />

          {/* Theme Toggle Button */}
          <button
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="hidden sm:flex w-10 h-10 rounded-xl items-center justify-center bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)] border border-[var(--card-border)] text-[var(--text-main)] transition-all cursor-pointer active:scale-95 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
            title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 stroke-[2]" />
            ) : (
              <Moon className="w-4 h-4 stroke-[2]" />
            )}
          </button>

          {/* Mobile Hamburger Toggle Button */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-menu"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)] border border-[var(--card-border)] text-[var(--text-main)] transition-all cursor-pointer active:scale-95 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

    </nav>

      {/* Mobile menu. It must sit OUTSIDE the <nav>: the nav has a backdrop blur, which makes a
          "fixed" child position itself against the 64px bar instead of the screen. */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-menu"
          className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto overscroll-contain bg-[var(--bg-app)]/95 backdrop-blur-xl border-b border-[var(--card-border)] flex flex-col p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 md:hidden animate-in fade-in slide-in-from-top-4 duration-200"
        >
          <div className="flex flex-col gap-3 font-semibold text-base text-[var(--text-main)] my-auto max-w-sm mx-auto w-full">
            <div className="sm:hidden flex flex-col gap-2">
              <AccountMenu variant="menu" />
              <button
                onClick={onToggleTheme}
                className="h-12 w-full rounded-xl border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] flex items-center justify-center gap-2 text-sm font-bold cursor-pointer active:scale-95"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              </button>
            </div>
            <Link
              href="/"
              aria-current={homeActive ? "page" : undefined}
              onClick={() => setMobileMenuOpen(false)}
              className="p-3.5 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-between hover:border-[var(--brand-lime)] transition-all"
            >
              <span>Home</span>
              <ArrowUpRight className="w-4 h-4 text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]" />
            </Link>
            {showLibrary &&
              [["/library", "Your Library"], ["/playlists", "Playlists"], ["/study", "Study & Goals"], ["/account", "About and Usage"], ["/settings", "Notification Settings"]].map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-3.5 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] flex items-center justify-between hover:border-[var(--brand-lime)] transition-all"
                >
                  <span>{label}</span>
                  <ArrowUpRight className="w-4 h-4 text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]" />
                </Link>
              ))}

            <Link
              href="/"
              onClick={() => {
                setMobileMenuOpen(false);
                if (isHome) window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="mt-4 h-12 rounded-full bg-[var(--brand-lime)] hover:bg-[var(--brand-lime-hover)] text-[#0E0F0C] font-black text-sm flex items-center justify-center gap-2 shadow-sm transition-all"
            >
              <Play className="w-4 h-4 fill-current ml-0.5" />
              <span>Summarize New Video</span>
            </Link>
          </div>

          <div className="text-center text-xs text-[var(--text-muted)] py-4">
            <span>SUMMARIZE.AI • Multimodal Video Intelligence</span>
          </div>
        </div>
      )}
    </>
  );
}
