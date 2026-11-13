#!/usr/bin/env python3
"""Builds the Supabase sign-in emails from the same design our own emails use (backend email_layout.py).

    python scripts/build_email_templates.py            # write supabase/templates/*.html
    python scripts/build_email_templates.py --check    # exit 1 if the files are out of date (used by the tests)

The files use Supabase's placeholders ({{ .ConfirmationURL }}, {{ .Email }}, ...). They are applied to a project by
pasting them into Authentication > Email Templates, or with scripts/apply_email_templates.py.
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from summarizer.features.notifications.email_layout import render_email  # noqa: E402

OUT = ROOT / "supabase" / "templates"
SITE = "{{ .SiteURL }}"
EXPIRY = "The link works once and expires in 1 hour."

TEMPLATES = {
    "confirmation": {
        "subject": "Confirm your email for SUMMARIZE.AI",
        "html": render_email(
            preheader="One tap to finish creating your free account.",
            heading="Confirm your email address",
            paragraphs=["Welcome! Confirm that {{ .Email }} is yours to finish creating your free SUMMARIZE.AI account."],
            button_label="Confirm email address", button_url="{{ .ConfirmationURL }}",
            note=f"{EXPIRY} If you did not sign up, you can safely ignore this email.",
            features=True, site_url=SITE,
            footer=["You are receiving this because this address was used to sign up at SUMMARIZE.AI."]),
    },
    "magic_link": {
        "subject": "Your SUMMARIZE.AI sign-in link",
        "html": render_email(
            preheader="Tap to sign in. No password needed.",
            heading="Your sign-in link",
            paragraphs=["Use the button below to sign in to SUMMARIZE.AI as {{ .Email }}. There is no password to remember."],
            button_label="Sign in to SUMMARIZE.AI", button_url="{{ .ConfirmationURL }}",
            note=f"{EXPIRY} If you did not ask for this, you can safely ignore this email: nobody can sign in without the link.",
            features=True, site_url=SITE,
            footer=["You are receiving this because a sign-in link was requested for this address."]),
    },
    "email_change": {
        "subject": "Confirm your new email for SUMMARIZE.AI",
        "html": render_email(
            preheader="Confirm the new address for your account.",
            heading="Confirm your new email address",
            paragraphs=["You asked to change the email address of your SUMMARIZE.AI account from {{ .Email }} to {{ .NewEmail }}."],
            button_label="Confirm new email", button_url="{{ .ConfirmationURL }}",
            note=f"{EXPIRY} If you did not ask for this, ignore this email and your address stays as it is.",
            site_url=SITE,
            footer=["You are receiving this because a change of email address was requested for your account."]),
    },
    "reauthentication": {
        "subject": "Your SUMMARIZE.AI verification code",
        "html": render_email(
            preheader="Your one-time code.",
            heading="Confirm it is you",
            paragraphs=["Enter this code to continue. It is for one use only."],
            code="{{ .Token }}",
            note="If you did not ask for this code, you can ignore this email.",
            site_url=SITE,
            footer=["You are receiving this because a verification code was requested for your account."]),
    },
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="only report whether the files are up to date")
    args = parser.parse_args()
    stale = []
    for name, template in TEMPLATES.items():
        path = OUT / f"{name}.html"
        if args.check:
            if not path.exists() or path.read_text() != template["html"]:
                stale.append(path.name)
        else:
            OUT.mkdir(parents=True, exist_ok=True)
            path.write_text(template["html"])
            print(f"wrote {path.relative_to(ROOT)}")
    if args.check and stale:
        print("out of date: " + ", ".join(stale) + " (run scripts/build_email_templates.py)")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
