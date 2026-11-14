"""Read the audit log (admins only)."""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from ...core.db import connection
from .guard import MAX_PAGE, Staff, like_pattern, require

router = APIRouter(prefix="/audit")


@router.get("")
def list_audit(action: Optional[str] = Query(default=None, max_length=60), actor: Optional[str] = Query(default=None, max_length=200),
               target: Optional[str] = Query(default=None, max_length=80),
               limit: int = Query(default=50, ge=1, le=MAX_PAGE), offset: int = Query(default=0, ge=0, le=1_000_000),
               staff: Staff = Depends(require("audit.view"))):
    conditions, params = [], []
    if action:
        conditions.append("action like %s escape '\\'")
        params.append(like_pattern(action)[1:])
    if actor:
        conditions.append("actor_email ilike %s escape '\\'")
        params.append(like_pattern(actor))
    if target:
        conditions.append("target_id = %s")
        params.append(target)
    where = " and ".join(conditions) or "true"
    with connection() as conn:
        total = conn.execute(f"select count(*) c from public.admin_audit_log where {where}", params).fetchone()["c"]
        rows = conn.execute(
            f"select * from public.admin_audit_log where {where} order by id desc limit %s offset %s", (*params, limit, offset)).fetchall()
    return {"total": total, "items": [
        {"id": r["id"], "at": r["created_at"].isoformat(), "actor": r["actor_email"], "role": r["actor_role"],
         "action": r["action"], "target_type": r["target_type"], "target_id": r["target_id"], "detail": r["detail"]}
        for r in rows]}
