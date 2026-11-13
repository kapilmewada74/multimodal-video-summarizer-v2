"""What the outside world is told about HOW something was made.

The database keeps the exact engine label (useful to us for support and cost). Anything sent to a browser only says "AI",
so the page source and the network tab do not reveal which vendors or models are behind the service.
"""
FALLBACK_LABEL = "Rule-based fallback"
GENERIC_ENGINE = "AI"


def public_engine(label):
    if not label:
        return label
    return FALLBACK_LABEL if "fallback" in str(label).lower() else GENERIC_ENGINE


def public_message(message):
    """Job progress text without the engine name ("Video successfully summarized with X!" -> "... summarized!")."""
    text = message or ""
    return "Video successfully summarized!" if text.startswith("Video successfully summarized") else text
