import pytest

from summarizer.features.videos.youtube import extract_video_id, is_valid_youtube_url

VALID = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=30",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "youtube.com/watch?v=dQw4w9WgXcQ",
]

INVALID = [
    "",
    "   ",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/",
    "https://evil.com/?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "file:///etc/passwd",
]


@pytest.mark.parametrize("url", VALID)
def test_valid_youtube_urls(url):
    assert is_valid_youtube_url(url)


@pytest.mark.parametrize("url", INVALID)
def test_invalid_urls_rejected(url):
    assert not is_valid_youtube_url(url)


def test_non_string_rejected():
    assert not is_valid_youtube_url(None)
    assert not is_valid_youtube_url(123)


@pytest.mark.parametrize("url", [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
])
def test_extract_video_id(url):
    assert extract_video_id(url) == "dQw4w9WgXcQ"


@pytest.mark.parametrize("url", [
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=bad",
    "https://www.youtube.com/watch",
])
def test_extract_video_id_rejects_bad_urls(url):
    with pytest.raises(ValueError):
        extract_video_id(url)
