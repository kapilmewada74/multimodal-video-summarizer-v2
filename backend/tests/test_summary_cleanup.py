from summarizer.features.summaries.cleanup import clean_and_deduplicate_summary


def test_empty_input():
    assert clean_and_deduplicate_summary("") == ""
    assert clean_and_deduplicate_summary(None) == ""


def test_strips_cjk_characters():
    out = clean_and_deduplicate_summary("# Video Summary\n\nHello 你好 world")
    assert "你" not in out
    assert "Hello" in out and "world" in out


def test_keeps_longest_when_summary_repeated():
    short = "# Video Summary\n\n## 1. Main Topic\nShort."
    long = "# Video Summary\n\n## 1. Main Topic\n" + "Detailed explanation. " * 20
    out = clean_and_deduplicate_summary(short + "\n\n" + long)
    assert out.count("# Video Summary") == 1
    assert "Detailed explanation." in out


def test_cuts_repeated_main_topic_section():
    body = "x" * 150
    text = f"## 1. Main Topic\n{body}\n\n## 1. Main Topic\nrepeat"
    out = clean_and_deduplicate_summary(text)
    assert out.count("Main Topic") == 1


def test_collapses_blank_lines_and_trailing_rule():
    out = clean_and_deduplicate_summary("A\n\n\n\n\nB\n---")
    assert out == "A\n\nB"
