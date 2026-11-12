from fastapi import APIRouter, Depends

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ..jobs import repository as repo

router = APIRouter(prefix="/api/me", tags=["usage"])


@router.get("/usage")
def my_usage(user: AuthUser = Depends(current_user)):
    """Videos used today, the daily limit and when it resets."""
    with connection() as conn:
        return repo.usage(conn, user.id)
