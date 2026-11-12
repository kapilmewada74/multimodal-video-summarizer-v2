import re


def clean_and_deduplicate_summary(text: str) -> str:
    """Clean hallucinated CJK characters and deduplicate repeating summary blocks while preserving full detailed content."""
    if not text:
        return ""

    # Strip CJK characters and CJK punctuation
    cleaned = re.sub(r'[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]+', '', text)
    cleaned = re.sub(r'\(\s*\)', '', cleaned)
    cleaned = re.sub(r'\(\s*Section\s*\d*\s*\)', '', cleaned)
    cleaned = re.sub(r'\*\*\s*\*\*', '', cleaned)
    cleaned = re.sub(r'^\s*[-*]\s*[-*:\s]*$', '', cleaned, flags=re.MULTILINE)

    # 1. Check if the text contains multiple '# Video Summary' or '# Summary' blocks
    pattern = r'(?=(?:^|\n)#+\s*(?:Video\s+)?Summary)'
    blocks = [b.strip() for b in re.split(pattern, cleaned, flags=re.IGNORECASE) if b.strip()]
    if len(blocks) > 1:
        best_block = max(blocks, key=len)
        cleaned = best_block

    # 2. Check if a major section like '## Main Topic' or '## 1. Main Topic' repeats within the text
    m = re.search(r'(##\s*(?:\d+\.\s*)?Main Topic)', cleaned, re.IGNORECASE)
    if m:
        first_header = m.group(1)
        second_pos = cleaned.lower().find(first_header.lower(), m.end())
        if second_pos != -1 and second_pos > m.end() + 100:
            cleaned = cleaned[:second_pos].strip()

    # 3. Clean any artificial trailing delimiters
    cleaned = re.sub(r'\n\s*---\s*$', '', cleaned).strip()
    return re.sub(r'\n{3,}', '\n\n', cleaned).strip()
