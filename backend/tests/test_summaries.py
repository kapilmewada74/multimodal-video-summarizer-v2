from summarizer.features.summaries.service import summarize_transcript
from summarizer.shared.llm import LLMResult


class FakeChain:
    """Records prompts and answers with a short note."""
    def __init__(self):
        self.prompts = []

    def complete(self, prompt, **kwargs):
        self.prompts.append(prompt)
        return LLMResult(f"# Video Summary\n\nanswer {len(self.prompts)}", "Fake", "m")


def test_short_transcript_takes_one_request(monkeypatch):
    chain = FakeChain()
    summary, engine = summarize_transcript("a short transcript", chain)
    assert len(chain.prompts) == 1 and "a short transcript" in chain.prompts[0]
    assert "{transcript}" not in chain.prompts[0]
    assert engine == "Fake (m)" and "answer 1" in summary


def test_braces_in_the_transcript_do_not_break_the_prompt():
    chain = FakeChain()
    summarize_transcript("code: def f(x): return {x: 1} and {transcript} and {summaries}", chain)
    assert "return {x: 1}" in chain.prompts[0]


def test_long_transcript_is_summarized_in_parts_then_merged(monkeypatch):
    monkeypatch.setenv("SUMMARY_SINGLE_PASS_CHARS", "1000")
    monkeypatch.setenv("SUMMARY_CHUNK_CHARS", "400")
    chain = FakeChain()
    transcript = " ".join(f"Sentence number {i} about the topic." for i in range(120))
    summary, _ = summarize_transcript(transcript, chain)

    chunk_calls = [p for p in chain.prompts if "ONE PART of a longer video" in p]
    merge_calls = [p for p in chain.prompts if "Combine them" in p]
    assert len(chunk_calls) >= 5 and merge_calls
    assert "part 1 of" in chunk_calls[0] and "Sentence number 0" in chunk_calls[0]
    assert all(len(p) < 3500 for p in chain.prompts)  # no request is anywhere near the full text
    assert "answer" in summary


def test_every_part_of_a_long_transcript_is_covered(monkeypatch):
    monkeypatch.setenv("SUMMARY_SINGLE_PASS_CHARS", "500")
    monkeypatch.setenv("SUMMARY_CHUNK_CHARS", "300")
    chain = FakeChain()
    words = [f"w{i:04d}" for i in range(400)]
    summarize_transcript(" ".join(words), chain)
    seen = " ".join(p for p in chain.prompts if "ONE PART" in p)
    assert all(w in seen for w in words)


def test_very_long_notes_are_merged_in_stages(monkeypatch):
    monkeypatch.setenv("SUMMARY_SINGLE_PASS_CHARS", "300")
    monkeypatch.setenv("SUMMARY_CHUNK_CHARS", "200")

    class Wordy(FakeChain):
        def complete(self, prompt, **kwargs):
            self.prompts.append(prompt)
            return LLMResult("note " * 40, "Fake", "m")

    chain = Wordy()
    summarize_transcript("x " * 500, chain)
    merges = [p for p in chain.prompts if "Combine them" in p]
    assert len(merges) >= 3  # grouped merges first, then the final merge
