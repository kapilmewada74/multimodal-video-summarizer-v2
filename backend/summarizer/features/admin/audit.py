"""The audit log: who did what to whom, when. Written in the same transaction as the change itself, so a change can
never exist without its record. The table refuses updates and deletes (see the migration)."""
import json
from typing import Any, Dict, Optional

from fastapi import Request

from ...shared.net import client_ip, hash_ip
from .guard import Staff


def record(conn, staff: Staff, request: Request, action: str, *, target_type: Optional[str] = None,
           target_id: Optional[str] = None, detail: Optional[Dict[str, Any]] = None) -> None:
    conn.execute(
        """insert into public.admin_audit_log (actor_id, actor_email, actor_role, action, target_type, target_id, detail, ip_hash)
           values (%s, %s, %s, %s, %s, %s, %s::jsonb, %s)""",
        (staff.id, staff.email, staff.role, action, target_type, target_id, json.dumps(detail or {}),
         hash_ip(client_ip(request))))
