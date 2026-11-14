"""The person's own data: download everything, or delete the account.

Both are required for a product that holds personal study data (the right to a
copy and the right to erasure). Deleting removes every row, because every table
points at the account with ON DELETE CASCADE, and then the stored files.
"""
import json
import logging
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ...shared.storage import get_file_store

logger = logging.getLogger("summarizer.account")
router = APIRouter(prefix="/api/me", tags=["account"])

# (table, column holding the owner, columns to leave out of the export)
EXPORT_TABLES = [
    ("profiles", "user_id", ()),
    ("user_videos", "user_id", ()),
    ("notes", "user_id", ()),
    ("playlists", "user_id", ()),
    ("documents", "user_id", ("storage_key", "extracted_text")),
    ("video_uploads", "user_id", ("storage_key",)),
    ("study_sessions", "user_id", ()),
    ("daily_stats", "user_id", ()),
    ("goals", "user_id", ()),
    ("quiz_attempts", "user_id", ()),
    ("user_edits", "user_id", ()),
    ("user_edit_versions", "user_id", ()),
    ("user_outputs", "user_id", ()),
    ("notification_prefs", "user_id", ()),
    ("notifications", "user_id", ()),
    ("share_links", "owner_id", ("token",)),
    ("generation_usage", "user_id", ()),
    ("support_tickets", "user_id", ("ip_hash",)),
]


def _plain(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    if isinstance(value, (bytes, memoryview)):
        return None
    return value


def build_export(conn, user_id: str, email: str | None) -> dict:
    data: dict = {"exported_at": datetime.utcnow().isoformat() + "Z", "account": {"id": user_id, "email": email}}
    for table, owner, skip in EXPORT_TABLES:
        rows = conn.execute(f"select * from public.{table} where {owner} = %s", (user_id,)).fetchall()
        data[table] = [{k: _plain(v) for k, v in row.items() if k not in skip} for row in rows]
    items = conn.execute(
        "select pi.* from public.playlist_items pi join public.playlists p on p.id = pi.playlist_id where p.user_id = %s",
        (user_id,)).fetchall()
    data["playlist_items"] = [{k: _plain(v) for k, v in row.items()} for row in items]
    return data


@router.get("/export")
def download_my_data(user: AuthUser = Depends(current_user)):
    with connection() as conn:
        body = build_export(conn, user.id, user.email)
    return Response(json.dumps(body, ensure_ascii=False, indent=2), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="my-data.json"',
                             "Cache-Control": "no-store"})


class DeleteAccount(BaseModel):
    confirm: str


def storage_keys(conn, user_id: str) -> list[str]:
    keys = [r["storage_key"] for r in conn.execute("select storage_key from public.documents where user_id = %s", (user_id,))]
    keys += [r["storage_key"] for r in conn.execute("select storage_key from public.video_uploads where user_id = %s", (user_id,))]
    return keys


@router.delete("")
def delete_my_account(payload: DeleteAccount, user: AuthUser = Depends(current_user)):
    """Permanently delete the account and everything in it. The caller must type DELETE."""
    if payload.confirm != "DELETE":
        raise AppError(400, "confirmation_required", 'Type "DELETE" to confirm.')
    with connection() as conn:
        keys = storage_keys(conn, user.id)
        # Shared summaries of public videos are a cache owned by no one; only the person's own rows go.
        conn.execute("delete from auth.users where id = %s", (user.id,))
    store = get_file_store()
    failed = 0
    for key in keys:
        try:
            store.delete(key)
        except Exception:
            failed += 1
    if failed:
        logger.error("Account deleted but %d stored file(s) could not be removed.", failed)
    return {"deleted": True, "files_removed": len(keys) - failed}
