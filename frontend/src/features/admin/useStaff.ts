"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { adminGet, type StaffInfo } from "./api";
import { hasPermission } from "./format";

// One lookup per signed-in person for the life of the page, however many components ask.
const lookups = new Map<string, Promise<StaffInfo>>();

export function forgetStaffLookups(): void {
  lookups.clear();
}

export interface StaffState {
  loading: boolean;
  userId: string | null;
  isStaff: boolean;
  role: StaffInfo["role"];
  permissions: string[];
  can: (permission: string) => boolean;
}

/** Is the signed-in person staff, and what may they do? Never throws: any failure simply means "not staff". */
export function useStaff(): StaffState {
  const { ready, signedIn, session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [info, setInfo] = useState<StaffInfo | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!ready || !signedIn || !userId) {
      setInfo(null);
      setDone(ready);
      return;
    }
    let cancelled = false;
    setDone(false);
    let lookup = lookups.get(userId);
    if (!lookup) {
      lookup = adminGet<StaffInfo>("/me");
      lookups.set(userId, lookup);
      lookup.catch(() => lookups.delete(userId));
    }
    lookup
      .then((value) => !cancelled && setInfo(value))
      .catch(() => !cancelled && setInfo(null))
      .finally(() => !cancelled && setDone(true));
    return () => { cancelled = true; };
  }, [ready, signedIn, userId]);

  const permissions = info?.is_staff ? info.permissions ?? [] : [];
  return {
    loading: !done,
    userId,
    isStaff: !!info?.is_staff,
    role: info?.is_staff ? info.role : undefined,
    permissions,
    can: (permission) => hasPermission(permissions, permission),
  };
}
