import random

import pytest

from summarizer.features.playlists import fractional
from summarizer.features.playlists.fractional import DIGITS, evenly_spaced, key_between, needs_rebalance, validate


def test_first_key_and_ends():
    first = key_between(None, None)
    assert key_between(None, first) < first < key_between(first, None)


@pytest.mark.parametrize("a,b", [(None, "1"), ("0V", "1"), ("a", "b"), ("a", "a1"), ("az", "b"), ("V", "W"), ("zz", None),
                                 (None, "01"), ("1", "10001"), ("0V", "0W")])
def test_result_is_strictly_between(a, b):
    key = key_between(a, b)
    validate(key)
    assert (a is None or a < key) and (b is None or key < b)


def test_random_insertions_stay_ordered_unique_and_valid():
    rng = random.Random(42)
    items = []
    for _ in range(4000):
        i = rng.randint(0, len(items))
        key = key_between(items[i - 1] if i > 0 else None, items[i] if i < len(items) else None)
        validate(key)
        items.insert(i, key)
    assert items == sorted(items) and len(set(items)) == len(items)
    assert max(len(k) for k in items) < 10  # random use keeps keys short


def test_always_inserting_at_the_front_and_the_end_stays_valid():
    keys = [key_between(None, None)]
    for _ in range(200):
        keys.insert(0, key_between(None, keys[0]))
        keys.append(key_between(keys[-1], None))
    assert keys == sorted(keys) and len(set(keys)) == len(keys)
    assert all(not k.endswith("0") for k in keys)


def test_repeated_insertion_in_one_spot_grows_keys_and_is_detected():
    low = key_between(None, None)
    high = key_between(low, None)
    for _ in range(600):
        high = key_between(low, high)  # keep squeezing toward `low`
        assert low < high
        if needs_rebalance(high):
            break
    assert needs_rebalance(high)  # the list would be renumbered at this point


def test_keys_sort_bytewise_in_the_documented_alphabet():
    assert list(DIGITS) == sorted(DIGITS)


@pytest.mark.parametrize("bad", ["", "a0", "a b", "é", "0"])
def test_invalid_keys_are_rejected(bad):
    with pytest.raises(ValueError):
        validate(bad)
    with pytest.raises(ValueError):
        key_between(bad, None)


def test_inverted_or_equal_bounds_are_rejected():
    with pytest.raises(ValueError):
        key_between("b", "a")
    with pytest.raises(ValueError):
        key_between("a", "a")


@pytest.mark.parametrize("count", [0, 1, 2, 61, 62, 63, 200, 5000])
def test_evenly_spaced_keys(count):
    keys = evenly_spaced(count)
    assert len(keys) == count and keys == sorted(keys) and len(set(keys)) == count
    for key in keys:
        validate(key)
    if count >= 2:  # there is always room to insert between two neighbours
        assert fractional.key_between(keys[0], keys[1]) not in keys
