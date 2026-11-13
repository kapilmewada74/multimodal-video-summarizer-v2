"""Email delivery through Resend (https://resend.com). Off unless RESEND_API_KEY is set."""
import logging
from typing import Optional

import httpx

from ...core.config import get_settings
from .email_layout import render_email

logger = logging.getLogger("summarizer.email")
RESEND_URL = "https://api.resend.com/emails"


def email_available() -> bool:
    return bool(get_settings().resend_api_key)


def render(title: str, body: Optional[str], link: Optional[str]) -> tuple[str, str]:
    """(plain text, HTML). Everything user-visible is escaped in the HTML."""
    settings = get_settings()
    url = f"{settings.app_url}{link}" if link and link.startswith("/") else None
    text = "\n\n".join(part for part in (title, body, url) if part)
    markup = render_email(
        preheader=body or title, heading=title, paragraphs=[body] if body else [],
        button_label="Open in Summarize" if url else None, button_url=url,
        footer=[f"You can change which emails you get in Settings: {settings.app_url}/settings"],
        site_url=settings.app_url)
    return text, markup


def send_notification_email(address: str, title: str, body: Optional[str], link: Optional[str],
                            client: Optional[httpx.Client] = None) -> bool:
    settings = get_settings()
    if not settings.resend_api_key:
        return False
    text, markup = render(title, body, link)
    payload = {"from": settings.email_from, "to": [address], "subject": title, "text": text, "html": markup}
    headers = {"Authorization": f"Bearer {settings.resend_api_key}"}
    try:
        response = (client or httpx).post(RESEND_URL, json=payload, headers=headers, timeout=15.0)
    except httpx.HTTPError as exc:
        logger.warning("Email could not be sent: %s", type(exc).__name__)
        return False
    if response.status_code >= 300:
        logger.warning("Email provider answered HTTP %s", response.status_code)
        return False
    return True
