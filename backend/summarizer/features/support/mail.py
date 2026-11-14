"""Emails about support tickets. Both are off unless RESEND_API_KEY is set.

* A note to the team when someone uses the Contact us form (only if SUPPORT_NOTIFY_EMAIL is set).
* A reply from staff to the person who wrote in.

There is deliberately NO automatic "we got your message" email to the visitor: the form is open to anyone, so that
would let a stranger make us email any address they type in.
"""
import logging
from typing import Optional

import httpx

from ...core.config import get_settings
from ..notifications.email import RESEND_URL
from ..notifications.email_layout import render_email

logger = logging.getLogger("summarizer.support")


def mail_available() -> bool:
    return bool(get_settings().resend_api_key)


def _send(to: str, subject: str, text: str, markup: str, reply_to: Optional[str] = None,
          client: Optional[httpx.Client] = None) -> bool:
    settings = get_settings()
    if not settings.resend_api_key:
        return False
    payload = {"from": settings.email_from, "to": [to], "subject": subject, "text": text, "html": markup}
    if reply_to:
        payload["reply_to"] = reply_to
    try:
        response = (client or httpx).post(RESEND_URL, json=payload,
                                          headers={"Authorization": f"Bearer {settings.resend_api_key}"}, timeout=15.0)
    except httpx.HTTPError as exc:
        logger.warning("Support email could not be sent: %s", type(exc).__name__)
        return False
    if response.status_code >= 300:
        logger.warning("Email provider answered HTTP %s", response.status_code)
        return False
    return True


def notify_team(ticket_id: str, *, email: str, name: Optional[str], category: str, subject: str, message: str,
                client: Optional[httpx.Client] = None) -> bool:
    settings = get_settings()
    if not settings.support_notify_email:
        return False
    who = f"{name} <{email}>" if name else email
    link = f"{settings.app_url}/admin/support/{ticket_id}"
    # The visitor's text goes in as plain text and is escaped by the layout; it is never treated as markup.
    body = f"From: {who}\nCategory: {category}\n\n{message}"
    markup = render_email(preheader=subject, heading=f"New message: {subject}", paragraphs=body.split("\n\n"),
                          button_label="Open in the admin panel", button_url=link, site_url=settings.app_url)
    return _send(settings.support_notify_email, f"[Support] {subject}"[:200], f"{body}\n\n{link}", markup,
                 reply_to=email, client=client)


def send_reply(to: str, subject: str, message: str, client: Optional[httpx.Client] = None) -> bool:
    settings = get_settings()
    heading = f"Re: {subject}"[:200]
    markup = render_email(preheader=message[:120], heading=heading, paragraphs=message.split("\n\n"),
                          footer=["You are receiving this because you wrote to us through the Contact page."],
                          site_url=settings.app_url)
    reply_to = settings.support_notify_email
    return _send(to, heading, message, markup, reply_to=reply_to, client=client)
