"""Our emails (sign-in and notifications) share one design. These checks keep it safe and in sync."""
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from build_email_templates import TEMPLATES  # noqa: E402
from summarizer.features.notifications import email  # noqa: E402
from summarizer.features.notifications.email_layout import render_email  # noqa: E402

PLACEHOLDER = re.compile(r"\{\{\s*\.(\w+)\s*\}\}")
ALLOWED = {"ConfirmationURL", "Email", "NewEmail", "SiteURL", "Token"}


def test_the_files_in_the_repo_are_up_to_date():
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / "build_email_templates.py"), "--check"],
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stdout


@pytest.mark.parametrize("name", list(TEMPLATES))
def test_a_template_only_uses_placeholders_supabase_knows(name):
    markup = TEMPLATES[name]["html"]
    assert set(PLACEHOLDER.findall(markup)) <= ALLOWED
    assert "{{" not in PLACEHOLDER.sub("", markup), "a stray {{ would break the Go template"


@pytest.mark.parametrize("name,needed", [("confirmation", "ConfirmationURL"), ("magic_link", "ConfirmationURL"),
                                         ("email_change", "ConfirmationURL"), ("reauthentication", "Token")])
def test_a_template_carries_the_link_or_code_it_exists_for(name, needed):
    assert needed in set(PLACEHOLDER.findall(TEMPLATES[name]["html"]))


@pytest.mark.parametrize("name", list(TEMPLATES))
def test_a_template_works_in_real_mail_clients(name):
    markup = TEMPLATES[name]["html"]
    assert "<img" not in markup and "url(" not in markup, "images and CSS urls are blocked by many clients"
    assert "prefers-color-scheme:dark" in markup and "color-scheme" in markup
    assert "role='presentation'" in markup and "<script" not in markup
    assert TEMPLATES[name]["subject"].endswith("SUMMARIZE.AI") or "SUMMARIZE.AI" in TEMPLATES[name]["subject"]


def test_text_is_escaped_but_placeholders_survive():
    markup = render_email(preheader="p", heading="<b>x</b>", paragraphs=["a & <script>alert(1)</script>"],
                          button_label="Go", button_url="{{ .ConfirmationURL }}")
    assert "<script>" not in markup and "&lt;script&gt;" in markup and "&lt;b&gt;x&lt;/b&gt;" in markup
    assert "href='{{ .ConfirmationURL }}'" in markup


def test_a_link_cannot_break_out_of_its_attribute():
    markup = render_email(preheader="p", heading="h", paragraphs=[], button_label="Go", button_url="https://a.example/'><script>x</script>")
    assert "<script>x" not in markup


def test_notification_emails_use_the_same_design(monkeypatch):
    from conftest import set_env
    set_env(monkeypatch, APP_URL="https://app.example")
    text, markup = email.render("Goal reached <3", "You studied 30 minutes.", "/study")
    assert "SUMMARIZE" in markup and "prefers-color-scheme:dark" in markup
    assert "Goal reached &lt;3" in markup and "<3" not in markup.replace("&lt;3", "")
    assert "https://app.example/study" in markup and "https://app.example/study" in text
    assert "Open in Summarize" in markup and "https://app.example/settings" in markup
