"""The admin panel's API, all under /api/admin. See docs/ADMIN_PANEL.md for the design."""
from fastapi import APIRouter, Depends

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from . import audit_log, overview, staff, tickets, users, videos
from .guard import find_staff, no_store
from .permissions import permissions_for

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(no_store)])


@router.get("/me")
def who_am_i(user: AuthUser = Depends(current_user)):
    """Is the signed-in person staff, and what may they do? Answers 200 for everyone so the website can decide
    whether to show the Admin link, without anyone getting an error."""
    with connection() as conn:
        member = find_staff(conn, user)
    if member is None:
        return {"is_staff": False}
    return {"is_staff": True, "role": member.role, "email": user.email, "permissions": sorted(permissions_for(member.role))}


for part in (overview.router, users.router, tickets.router, videos.router, staff.router, audit_log.router):
    router.include_router(part)
