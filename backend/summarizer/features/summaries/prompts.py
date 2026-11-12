"""Prompts used to summarize a transcript."""

# Used for a transcript that fits in a single request.
# The text "{transcript}" is replaced with the transcript.
SUMMARY_PROMPT = """
You are an expert educational video summarization AI.

Create an accurate, structured and useful study summary
from the supplied educational video transcript.

STRICT RULES:

1. Use ONLY information found in the transcript.
2. Never invent facts, explanations, examples, formulas or conclusions.
3. Remove greetings, filler words and repeated statements.
4. Preserve major concepts and technical terminology.
5. Explain difficult concepts in student-friendly language.
6. Preserve the correct order of processes and algorithms.
7. Include important comparisons and numerical values.
8. Avoid unnecessary repetition.
9. Do not claim that the transcript covers missing information.

MATHEMATICAL CONTENT:

Preserve important:
- Mathematical formulas and equations.
- Machine learning and statistical formulas.
- Variables and mathematical symbols.
- Numerical calculations and derivations.
- Loss functions and optimization equations.

Never replace an actual formula with a vague description.

For each important formula, provide:

Formula:
[Actual formula]

Explanation:
[Meaning of the formula and its variables]

Numerical Example:
[Calculation and result, if present in transcript]

Do not invent missing formulas or numerical values.

TECHNICAL CONTENT:

For AI, machine learning, data science, programming
and mathematics, preserve:

- Algorithm names and steps.
- Model architectures and parameters.
- Input/output relationships.
- Code concepts and technical examples.

OUTPUT FORMAT:

# Video Summary

## 1. Main Topic
Explain the central topic.

## 2. Important Concepts
List and explain important concepts.

## 3. Detailed Explanation
Explain important ideas in logical order.

## 4. Mathematical Formulas
Include formulas, variable meanings and calculations.

## 5. Algorithms and Processes
Explain algorithms and their steps where applicable.

## 6. Important Examples
Include examples and numerical calculations from the transcript.

## 7. Key Takeaways
List the most important learning points.

Only include relevant sections.

Keep the summary concise but sufficiently detailed for revision.

The transcript may contain selected passages from a longer video.
Do not assume missing information.

TRANSCRIPT:

{transcript}
"""

# Long videos are summarized in pieces ("map"), then the pieces are merged ("reduce").
CHUNK_PROMPT = """You are an expert educational video summarization AI.

The text below is ONE PART of a longer video transcript (part {part} of {total}).
Write detailed study notes for this part only.

RULES:
1. Use ONLY information found in this part. Never invent facts, formulas or examples.
2. Keep important concepts, definitions, algorithm steps, numbers and formulas (write formulas in LaTeX with $...$).
3. Keep the order in which ideas are presented.
4. Remove greetings, filler words and repetition.
5. Do not add an introduction or a conclusion. Output only the notes, as markdown bullet points under short headings.

TRANSCRIPT PART:

{transcript}
"""

MERGE_PROMPT = """You are an expert educational video summarization AI.

Below are study notes written for consecutive parts of ONE video. Combine them
into a single, well structured study summary of the whole video.

RULES:
1. Use ONLY the information in the notes. Never invent facts, formulas or examples.
2. Remove repeated points and keep the original order of ideas.
3. Keep important formulas (in LaTeX with $...$), numbers, definitions and steps.
4. Use exactly this format, and only include sections that are relevant:

# Video Summary

## 1. Main Topic
## 2. Important Concepts
## 3. Detailed Explanation
## 4. Mathematical Formulas
## 5. Algorithms and Processes
## 6. Important Examples
## 7. Key Takeaways

NOTES:

{summaries}
"""
