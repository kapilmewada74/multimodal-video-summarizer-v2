#!/usr/bin/env python3
"""Makes the FIRST admin (or recovers access if every admin is locked out). After that, admins add the others
from the panel (Admin > Staff), which is audited.

    python scripts/grant_staff.py --email you@example.com                    # dry run: shows what would happen
    python scripts/grant_staff.py --email you@example.com --apply            # makes them an admin
    python scripts/grant_staff.py --email helper@example.com --role sub_admin --apply
    python scripts/grant_staff.py --email you@example.com --remove --apply   # takes the role away

Needs DATABASE_URL (the same one the API uses, from .env or the environment). The person must have signed in to the
website once, so that their account exists. Every change made here is written to the audit log as "script".
"""
import argparse
import json
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", choices=("admin", "sub_admin"), default="admin")
    parser.add_argument("--remove", action="store_true", help="take the staff role away")
    parser.add_argument("--apply", action="store_true", help="actually do it (without this, only shows what would happen)")
    args = parser.parse_args()

    url = os.getenv("DATABASE_URL")
    if not url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2

    email = args.email.strip().lower()
    with psycopg.connect(url, autocommit=False) as conn:
        user = conn.execute("select id, coalesce(is_anonymous, false) from auth.users where lower(email) = %s", (email,)).fetchone()
        if not user or user[1]:
            print(f"No signed-in account with the email {email}. Ask them to sign in to the website once first.", file=sys.stderr)
            return 1
        uid = str(user[0])
        current = conn.execute("select role from public.staff_roles where user_id = %s", (uid,)).fetchone()
        action = "remove" if args.remove else "grant"
        print(f"{email} ({uid}): currently {current[0] if current else 'not staff'}; would {action}"
              f"{'' if args.remove else ' ' + args.role}.")
        if not args.apply:
            print("Dry run. Add --apply to do it.")
            return 0

        if args.remove:
            if current and current[0] == "admin":
                admins = conn.execute("select count(*) from public.staff_roles where role = 'admin'").fetchone()[0]
                if admins <= 1:
                    print("That is the last admin. Make another admin first.", file=sys.stderr)
                    return 1
            conn.execute("delete from public.staff_roles where user_id = %s", (uid,))
            detail = {"role": current[0] if current else None}
        else:
            conn.execute(
                """insert into public.staff_roles (user_id, role) values (%s, %s)
                   on conflict (user_id) do update set role = excluded.role""", (uid, args.role))
            detail = {"role": args.role, "email": email}
        conn.execute(
            """insert into public.admin_audit_log (actor_email, actor_role, action, target_type, target_id, detail)
               values ('script', 'script', %s, 'user', %s, %s::jsonb)""",
            (f"staff.{action}", uid, json.dumps(detail)))
        conn.commit()
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
