"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Gauge, ListVideo, LogIn, LogOut, Settings, ShieldCheck, TrendingUp } from "lucide-react";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { useAuth } from "./AuthProvider";
import type { Profile } from "./session";
import { useStaff } from "../admin/useStaff";

/** The person's picture (from Google) or the first letter of their name or email. */
export function Avatar({ profile, size = 32 }: { profile: Profile; size?: number }) {
  const box = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  return profile.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" style={box} className="rounded-full object-cover" />
  ) : (
    <span style={box} className="flex items-center justify-center rounded-full bg-[var(--brand-lime)] font-black text-[#0E0F0C]" aria-hidden>{profile.initial}</span>
  );
}

/** "Sign in" for visitors; for signed-in people, their picture with a menu (pages and sign out). */
export function AccountMenu({ variant = "bar" }: { variant?: "bar" | "menu" }) {
  const { ready, configured, signedIn, profile, signOut } = useAuth();
  const router = useRouter();
  const staff = useStaff();
  if (!configured || !ready) return null;

  if (!signedIn) {
    return (
      <Link
        href="/login"
        className={`${variant === "menu" ? "h-12 w-full text-sm" : "h-10 text-xs"} inline-flex items-center justify-center gap-2 rounded-xl border border-transparent bg-[var(--brand-lime)] px-4 font-bold text-[#0E0F0C] transition-all hover:bg-[var(--brand-lime-hover)] active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--text-main)]`}
      >
        <LogIn className="h-4 w-4" /> Sign in
      </Link>
    );
  }

  if (variant === "menu") {
    // Inside the phone menu: who is signed in, and a sign-out button.
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
        <Avatar profile={profile} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{profile.name ?? profile.email ?? "Your account"}</p>
          {profile.name && profile.email && <p className="truncate text-xs font-normal text-[var(--text-muted)]">{profile.email}</p>}
        </div>
        <button onClick={() => void signOut()} aria-label="Sign out" className="flex h-10 items-center gap-1.5 rounded-xl border border-[var(--card-border)] px-3 text-xs font-bold cursor-pointer active:scale-95">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    );
  }

  return (
    <ActionMenu
      label={`Account: ${profile.email ?? "signed in"}`}
      icon={<Avatar profile={profile} size={30} />}
      heading={profile.email ?? "Your account"}
      width="w-60"
      items={[
        { key: "library", label: "Your library", icon: <BookOpen className="h-4 w-4" />, onSelect: () => router.push("/library") },
        { key: "playlists", label: "Playlists", icon: <ListVideo className="h-4 w-4" />, onSelect: () => router.push("/playlists") },
        { key: "study", label: "Study and goals", icon: <TrendingUp className="h-4 w-4" />, onSelect: () => router.push("/study") },
        { key: "account", label: "About and Usage", icon: <Gauge className="h-4 w-4" />, onSelect: () => router.push("/account") },
        { key: "settings", label: "Notification settings", icon: <Settings className="h-4 w-4" />, onSelect: () => router.push("/settings") },
        ...(staff.isStaff
          ? [{ key: "admin", label: "Admin panel", icon: <ShieldCheck className="h-4 w-4" />, onSelect: () => router.push("/admin"), separated: true }]
          : []),
        { key: "out", label: "Sign out", icon: <LogOut className="h-4 w-4" />, onSelect: () => void signOut(), separated: true },
      ]}
    />
  );
}
