#!/usr/bin/env python3
"""Puts the branded sign-in emails on a HOSTED Supabase project (the same as pasting them in the dashboard).

    export SUPABASE_ACCESS_TOKEN=...        # a personal access token: https://supabase.com/dashboard/account/tokens
    python scripts/apply_email_templates.py --project-ref <ref>            # shows what would change (dry run)
    python scripts/apply_email_templates.py --project-ref <ref> --apply    # sends it

Only the email subjects and bodies are changed. Nothing else in the project's auth settings is touched.
"""
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_email_templates import TEMPLATES  # noqa: E402

# The Management API names these fields mailer_subjects_<name> and mailer_templates_<name>_content.
FIELDS = ("confirmation", "magic_link", "email_change", "reauthentication")


def payload() -> dict:
    body = {}
    for name in FIELDS:
        body[f"mailer_subjects_{name}"] = TEMPLATES[name]["subject"]
        body[f"mailer_templates_{name}_content"] = TEMPLATES[name]["html"]
    return body


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", default=os.getenv("SUPABASE_PROJECT_REF"), help="the project reference (the id in its URL)")
    parser.add_argument("--apply", action="store_true", help="really send it (default is a dry run)")
    args = parser.parse_args()
    token = os.getenv("SUPABASE_ACCESS_TOKEN")
    if not args.project_ref:
        print("Give --project-ref (or set SUPABASE_PROJECT_REF).")
        return 2
    body = payload()
    print(f"Project {args.project_ref}: would update {len(FIELDS)} emails:")
    for name in FIELDS:
        print(f"  - {name}: {TEMPLATES[name]['subject']!r} ({len(TEMPLATES[name]['html'])} bytes)")
    if not args.apply:
        print("Dry run. Add --apply to send.")
        return 0
    if not token:
        print("Set SUPABASE_ACCESS_TOKEN first.")
        return 2
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{args.project_ref}/config/auth", method="PATCH",
        data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        print(f"Done (HTTP {response.status}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
