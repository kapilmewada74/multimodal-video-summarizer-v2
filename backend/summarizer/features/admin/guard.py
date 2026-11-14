"""Who is calling an admin route, and may they?

A person who is not staff gets a plain 404, so the panel does not advertise itself. Staff without the needed power
get 403. Roles are read from the database on every call (admin routes are low traffic), so taking a role away
works immediately. Changes are rate limited per person, so one hijacked staff session cannot do much damage quickly.
"""
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import Depends, Request, Response

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ...shared import throttle
from .permissions import mask_email, permissions_for

CHANGES_PER_5_MIN = 60
MAX_PAGE = 100


@dataclass(frozen=True)
class Staff:
    id: str
    email: Optional[str]
    role: str

    def can(self, permission: str) -> bool:
        return permission in permissions_for(self.role)

    def see_email(self, email: Optional[str]) -> Optional[str]:
        return email if self.can("users.pii") else mask_email(email)


def find_staff(conn, user: AuthUser) -> Optional[Staff]:
    row = conn.execute("select role from public.staff_roles where user_id = %s", (user.id,)).fetchone()
    return Staff(id=user.id, email=user.email, role=row["role"]) if row else None


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def require(permission: str) -> Callable:
    """FastAPI dependency: the caller must be staff with this power."""
    def dependency(request: Request, user: AuthUser = Depends(current_user)) -> Staff:
        with connection() as conn:
            staff = find_staff(conn, user)
        if staff is None:
            raise AppError(404, "not_found", "Not found.")
        if not staff.can(permission):
            raise AppError(403, "forbidden", "Your role cannot do this.")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            throttle.check(f"admin:{staff.id}", CHANGES_PER_5_MIN, 300, what="changes")
        return staff
    return dependency


def like_pattern(text: str) -> str:
    """A LIKE pattern that matches `text` anywhere, with the user's % and _ taken literally."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
