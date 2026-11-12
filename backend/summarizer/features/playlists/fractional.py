"""Fractional ordering keys for drag-and-drop lists.

Every item has a text key. To put an item between two others, a new key is made
that sorts between theirs, so moving one item changes exactly one row (the others
are never renumbered). Keys use the characters 0-9, A-Z, a-z, which sort in that
order under byte-wise ("C") comparison, and never end in "0".
"""
from typing import List, Optional

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
ZERO = DIGITS[0]
BASE = len(DIGITS)

# A key longer than this means many moves in the same spot; the list is renumbered.
MAX_KEY_LENGTH = 40


def _midpoint(a: str, b: Optional[str]) -> str:
    """A string strictly between a and b (b None means 'no upper limit')."""
    if b is not None:
        # Keep the shared beginning and solve the remaining part.
        n = 0
        while (a[n] if n < len(a) else ZERO) == (b[n] if n < len(b) else None):
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])

    digit_a = DIGITS.index(a[0]) if a else 0
    digit_b = DIGITS.index(b[0]) if b else BASE
    if digit_b - digit_a > 1:
        return DIGITS[round(0.5 * (digit_a + digit_b))]
    # The first characters are neighbours: go one level deeper.
    if b is not None and len(b) > 1:
        return b[:1]
    return DIGITS[digit_a] + _midpoint(a[1:], None)


def validate(key: Optional[str]) -> None:
    if key is None:
        return
    if not key or key.endswith(ZERO) or any(c not in DIGITS for c in key):
        raise ValueError(f"Invalid order key: {key!r}")


def key_between(a: Optional[str], b: Optional[str]) -> str:
    """A key that sorts strictly after `a` and strictly before `b`.
    `a` None means 'at the start', `b` None means 'at the end'."""
    validate(a)
    validate(b)
    if a is not None and b is not None and a >= b:
        raise ValueError("The lower key must sort before the upper key.")
    return _midpoint(a or "", b)


def evenly_spaced(count: int) -> List[str]:
    """`count` fresh keys in increasing order, with room to insert between any two."""
    if count <= 0:
        return []
    width = 1
    while BASE ** width < count + 1:
        width += 1
    keys = []
    for i in range(1, count + 1):
        number, chars = i, []
        for _ in range(width):
            number, rest = divmod(number, BASE)
            chars.append(DIGITS[rest])
        keys.append("".join(reversed(chars)) + DIGITS[BASE // 2])  # never ends in "0"
    return keys


def needs_rebalance(key: str) -> bool:
    return len(key) > MAX_KEY_LENGTH
