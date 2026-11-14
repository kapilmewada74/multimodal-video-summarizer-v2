"""Who may do what in the admin panel.

Two roles, kept deliberately small:

* admin      a few main leads. Everything, including who else is staff, suspensions, limits and the audit log.
* sub_admin  support people. Answer tickets, look at users and videos (with email addresses partly hidden), and
             remove a bad shared flashcard/quiz/mind map/slides copy. They cannot change accounts, limits or staff.

The table lives in code on purpose: a role's powers change through a reviewed deploy, while WHO holds a role changes
at any time in the panel (and is audited). Adding a power is one line here plus the permission on its route.
"""
from typing import Dict, FrozenSet

ADMIN = "admin"
SUB_ADMIN = "sub_admin"
ROLES = (ADMIN, SUB_ADMIN)

ALL: FrozenSet[str] = frozenset({
    "overview.view",    # the numbers on the first screen
    "system.view",      # queue health and alerts
    "tickets.view",
    "tickets.manage",   # change status, take a ticket, add a note, email a reply
    "users.view",       # list and open accounts (details only, never their study content)
    "users.pii",        # see full email addresses and search by part of an address
    "users.suspend",
    "users.limits",     # change someone's daily video allowance
    "videos.view",
    "outputs.reset",    # remove a shared generated copy so it is generated again
    "staff.view",
    "staff.manage",     # grant, change and remove staff roles
    "audit.view",
})

ROLE_PERMISSIONS: Dict[str, FrozenSet[str]] = {
    ADMIN: ALL,
    SUB_ADMIN: frozenset({
        "overview.view", "tickets.view", "tickets.manage", "users.view", "videos.view", "outputs.reset",
    }),
}


def permissions_for(role: str) -> FrozenSet[str]:
    return ROLE_PERMISSIONS.get(role, frozenset())


def mask_email(email: str | None) -> str | None:
    """ab***@gmail.com: enough to recognise an address you already know, not enough to harvest it."""
    if not email or "@" not in email:
        return email
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain}"
