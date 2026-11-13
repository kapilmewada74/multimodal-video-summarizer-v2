"""The one HTML email design used everywhere: our own notification emails and the Supabase sign-in emails.

Email clients are stuck in 2010: table layout, inline styles, no external images (many clients block them), so the
logo mark is plain HTML. A small <style> block gives dark mode in the clients that support it (Apple Mail, iOS Mail,
Outlook for Mac); the rest show the light design, which is also fine.

Text is escaped. Values that are Supabase placeholders (for example `{{ .ConfirmationURL }}`) contain nothing that
escaping changes, so they pass through untouched.
"""
import html
from typing import Iterable, Optional

FEATURES = ("Summary", "Transcript", "Flashcards", "Mind map", "Slides", "Quiz")

# Light = our light theme (warm off-white, white card, lime button). Dark = our dark theme (neutral black).
LIGHT = {"page": "#FEFAF5", "card": "#FFFFFF", "border": "#E6E2D8", "text": "#0E0F0C", "muted": "#57534E", "lime": "#D9EC95", "accent": "#6E8A12"}
DARK = {"page": "#0A0A0A", "card": "#111111", "border": "#262626", "text": "#F2F2F2", "muted": "#A3A3A3", "lime": "#D9EC95", "accent": "#D9EC95"}

# No quotes in the font list: it is placed inside single-quoted style attributes.
FONT = "-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif"


def _e(value: str) -> str:
    return html.escape(value, quote=True)


def _style() -> str:
    d = DARK
    return (
        "<style>"
        ":root{color-scheme:light dark;supported-color-schemes:light dark}"
        "a{color:inherit}"
        "@media (prefers-color-scheme:dark){"
        f".bg-page{{background-color:{d['page']}!important}}"
        f".bg-card{{background-color:{d['card']}!important}}"
        f".brd{{border-color:{d['border']}!important}}"
        f".t-main{{color:{d['text']}!important}}"
        f".t-muted{{color:{d['muted']}!important}}"
        f".t-accent{{color:{d['accent']}!important}}"
        f".chip{{border-color:{d['border']}!important;color:{d['text']}!important}}"
        "}"
        "@media only screen and (max-width:620px){.card{padding:24px 20px!important}.btn a{display:block!important}}"
        "</style>"
    )


def render_email(*, preheader: str, heading: str, paragraphs: Iterable[str], button_label: Optional[str] = None,
                 button_url: Optional[str] = None, code: Optional[str] = None, note: Optional[str] = None, features: bool = False,
                 footer: Iterable[str] = (), site_url: str = "") -> str:
    L = LIGHT
    paras = "".join(
        f"<p class='t-main' style='margin:0 0 14px;font-size:15px;line-height:1.65;color:{L['text']}'>{_e(p)}</p>" for p in paragraphs)

    button = ""
    fallback = ""
    if button_label and button_url:
        url = _e(button_url)
        button = (
            f"<table role='presentation' cellpadding='0' cellspacing='0' border='0' class='btn' style='margin:26px 0 8px'><tr>"
            f"<td bgcolor='{L['lime']}' style='border-radius:12px;background-color:{L['lime']}'>"
            f"<a href='{url}' target='_blank' style='display:inline-block;padding:14px 30px;font-family:{FONT};font-size:15px;"
            f"font-weight:800;line-height:1;color:#0E0F0C;text-decoration:none;border-radius:12px'>{_e(button_label)}</a>"
            "</td></tr></table>")
        fallback = (
            f"<p class='t-muted' style='margin:14px 0 0;font-size:12px;line-height:1.6;color:{L['muted']}'>"
            f"Button not working? Copy this address into your browser:<br>"
            f"<a href='{url}' class='t-muted' style='color:{L['muted']};word-break:break-all'>{url}</a></p>")

    code_html = ""
    if code:
        code_html = (
            f"<div class='brd' style='margin:22px 0 4px;padding:16px 18px;text-align:center;border:1px dashed {L['border']};border-radius:14px'>"
            f"<span class='t-main' style='font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;font-weight:800;"
            f"letter-spacing:.28em;color:{L['text']}'>{_e(code)}</span></div>")

    note_html = (f"<p class='t-muted' style='margin:18px 0 0;font-size:13px;line-height:1.6;color:{L['muted']}'>{_e(note)}</p>"
                 if note else "")

    chips = ""
    if features:
        cells = "".join(
            f"<span class='chip' style='display:inline-block;margin:0 6px 8px 0;padding:5px 11px;border:1px solid {L['border']};"
            f"border-radius:999px;font-size:12px;font-weight:700;color:{L['text']}'>{_e(name)}</span>" for name in FEATURES)
        chips = (f"<div style='margin-top:26px;padding-top:20px;border-top:1px solid {L['border']}' class='brd'>"
                 f"<p class='t-muted' style='margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;"
                 f"color:{L['muted']}'>Turn any video into</p>{cells}</div>")

    foot = "".join(
        f"<p class='t-muted' style='margin:0 0 6px;font-size:12px;line-height:1.6;color:{L['muted']}'>{_e(line)}</p>" for line in footer)
    home = (f"<a href='{_e(site_url)}' class='t-muted' style='color:{L['muted']};text-decoration:underline'>SUMMARIZE.AI</a>"
            if site_url else "SUMMARIZE.AI")

    logo = (
        "<table role='presentation' cellpadding='0' cellspacing='0' border='0'><tr>"
        f"<td width='36' height='36' align='center' valign='middle' bgcolor='{L['lime']}' "
        f"style='width:36px;height:36px;border-radius:10px;background-color:{L['lime']};font-family:{FONT};font-size:15px;color:#0E0F0C;"
        "line-height:36px;text-align:center'>&#9654;</td>"
        f"<td style='padding-left:10px;font-family:{FONT};font-size:17px;font-weight:800;letter-spacing:-.01em;color:{L['text']}' class='t-main'>"
        f"SUMMARIZE<span class='t-accent' style='color:{L['accent']}'>.AI</span></td></tr></table>")

    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta name='color-scheme' content='light dark'><meta name='supported-color-schemes' content='light dark'>"
        f"<title>{_e(heading)}</title>{_style()}</head>"
        f"<body class='bg-page' style='margin:0;padding:0;background-color:{L['page']}'>"
        f"<div style='display:none;max-height:0;overflow:hidden;opacity:0;color:transparent'>{_e(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>"
        f"<table role='presentation' width='100%' cellpadding='0' cellspacing='0' border='0' class='bg-page' bgcolor='{L['page']}' "
        f"style='background-color:{L['page']}'><tr><td align='center' style='padding:32px 14px'>"
        f"<table role='presentation' width='560' cellpadding='0' cellspacing='0' border='0' style='width:100%;max-width:560px'>"
        f"<tr><td style='padding:0 4px 18px'>{logo}</td></tr>"
        f"<tr><td class='card bg-card brd' bgcolor='{L['card']}' style='background-color:{L['card']};border:1px solid {L['border']};"
        f"border-radius:20px;padding:34px 34px 30px;font-family:{FONT}'>"
        f"<h1 class='t-main' style='margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-.02em;color:{L['text']}'>{_e(heading)}</h1>"
        f"{paras}{code_html}{button}{fallback}{note_html}{chips}</td></tr>"
        f"<tr><td style='padding:18px 8px 0;font-family:{FONT}'>{foot}"
        f"<p class='t-muted' style='margin:0;font-size:12px;color:{L['muted']}'>{home} &middot; Turn any video into study material</p>"
        "</td></tr></table></td></tr></table></body></html>"
    )
