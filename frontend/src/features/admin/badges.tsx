import React from "react";
import type { TicketStatus, UserRow } from "./api";
import { ROLE_LABEL } from "./format";
import { Badge } from "./ui";

export const STATUS_TONE: Record<TicketStatus, "warn" | "brand" | "good" | "neutral"> = {
  open: "warn", in_progress: "brand", resolved: "good", spam: "neutral",
};

export function UserBadges({ user }: { user: Pick<UserRow, "guest" | "suspended" | "role"> }) {
  return (
    <>
      {user.role && <Badge tone="brand">{ROLE_LABEL[user.role]}</Badge>}
      {user.guest && <Badge>Guest</Badge>}
      {user.suspended && <Badge tone="bad">Suspended</Badge>}
    </>
  );
}
