"""Slide outline generated from a video summary."""
import logging
from typing import Any, Dict

from ...shared.cache import BoundedCache, make_cache_key
from ...shared.jsonutil import parse_json_safely
from ...shared.llm import FallbackChain, LLMUnavailable, json_chain

logger = logging.getLogger("summarizer.slides")
_cache = BoundedCache()

PPT_SYSTEM_PROMPT = """You are an expert keynote presentation designer and structured slide content planner.
Based strictly on the provided summary and transcript, generate an outline for a professional 5 to 7 slide presentation.
To ensure the presentation slides render with immaculate visual balance, proper alignment, and zero text overflow or awkward spacing across custom graphical templates, follow these strict content budget rules:
- title: Short, punchy headline (strictly 3 to 7 words).
- kicker: Category kicker or subtitle (strictly 2 to 4 words).
- summary: Concise explanatory thesis/summary for the slide (strictly 25 to 45 words, 2-3 sentences).
- bullets: Exactly 3 to 4 distinct key takeaway points (strictly 8 to 14 words each).
- layout: Layout archetype choice ("split_left_image", "split_right_image", or "cards_right").
- image_asset: Best matching visual context:
  * "photo_classroom_raising_hands.png" (definitions, active discussion, questions, core concepts)
  * "photo_classroom_desks.png" (structure, discipline, institutional pillar, societal role)
  * "photo_school_building.png" (foundations, architecture, environment, key roles)
- notes: Speaker notes providing context for the presenter.
- formulas: If discussing mathematical equations or quantitative formulas, format them in clean standard LaTeX notation ($...$).

Return ONLY a valid JSON object matching this schema:
{
  "title": "Presentation Title",
  "slides": [
    {
      "title": "Slide Title",
      "kicker": "Category Kicker",
      "summary": "Brief 2-sentence explanatory overview of this topic.",
      "bullets": [
        "Concise insight one with clear takeaway",
        "Concise insight two explaining mechanism",
        "Concise insight three highlighting real-world impact",
        "Concise insight four outlining key outcome"
      ],
      "layout": "split_left_image",
      "image_asset": "photo_classroom_raising_hands.png",
      "notes": "Speaker notes providing speaking context for the presenter."
    }
  ]
}
"""


def sanitize_presentation_data(data: Dict[str, Any], default_title: str = "Presentation") -> Dict[str, Any]:
    """Sanitize and enforce strict text budgets, alternating archetypes, and image assignments."""
    if not isinstance(data, dict):
        data = {}
    title = str(data.get("title") or default_title).strip()
    raw_slides = data.get("slides")
    if not isinstance(raw_slides, list) or len(raw_slides) == 0:
        raw_slides = []

    layouts = ["split_left_image", "split_right_image", "cards_right"]
    images = [
        "photo_classroom_raising_hands.png",
        "photo_classroom_desks.png",
        "photo_school_building.png"
    ]

    clean_slides = []
    for idx, s in enumerate(raw_slides):
        if not isinstance(s, dict):
            continue
        s_title = str(s.get("title") or f"Key Insight {idx + 1}").strip()
        title_words = s_title.split()
        if len(title_words) > 9:
            s_title = " ".join(title_words[:8]) + "..."

        s_kicker = str(s.get("kicker") or f"Section {idx + 1:02d} • Core Concept").strip()
        kicker_words = s_kicker.split()
        if len(kicker_words) > 6:
            s_kicker = " ".join(kicker_words[:5])

        # Bullets handling (budget max 4 bullets, max 16 words each)
        raw_bullets = s.get("bullets") or []
        if isinstance(raw_bullets, str):
            raw_bullets = [b.strip() for b in raw_bullets.split("\n") if b.strip()]
        clean_bullets = []
        for b in raw_bullets:
            b_str = str(b).lstrip("-*•0123456789. ").strip()
            if not b_str:
                continue
            words = b_str.split()
            if len(words) > 16:
                b_str = " ".join(words[:15]) + "..."
            clean_bullets.append(b_str)
            if len(clean_bullets) >= 4:
                break

        if not clean_bullets:
            clean_bullets = [
                f"Core foundation and analysis of {s_title}",
                "Structured mechanism for practical comprehension",
                "Key takeaway and contextual application"
            ]

        # Summary handling (25-45 words budget)
        s_summary = str(s.get("summary") or "").strip()
        if not s_summary or len(s_summary) < 15:
            s_summary = f"{s_title} establishes a foundational pillar in this subject. It provides structural clarity, methodological rigor, and actionable insight for learners."
        else:
            sum_words = s_summary.split()
            if len(sum_words) > 50:
                s_summary = " ".join(sum_words[:48]) + "..."

        # Layout assignment
        layout = s.get("layout")
        if layout not in layouts:
            layout = layouts[idx % len(layouts)]

        img = s.get("image_asset")
        if not img or img not in images:
            img = images[idx % len(images)]

        notes = str(s.get("notes") or f"Speaker notes and key discussion points for {s_title}.").strip()

        clean_slides.append({
            "title": s_title,
            "kicker": s_kicker,
            "summary": s_summary,
            "bullets": clean_bullets,
            "layout": layout,
            "image_asset": img,
            "notes": notes
        })

    if not clean_slides:
        clean_slides = [
            {
                "title": "Core Foundations & Objectives",
                "kicker": "Section 01 • Introduction",
                "summary": "This overview introduces the primary themes, foundational context, and practical significance covered throughout the lecture.",
                "bullets": [
                    "Establish clear baseline definitions and principles",
                    "Understand key interactions and structural components",
                    "Synthesize takeaways for practical application"
                ],
                "layout": "split_left_image",
                "image_asset": images[0],
                "notes": "Introduction to the presentation topics and goals."
            }
        ]

    return {
        "title": title,
        "slides": clean_slides,
        "provider": data.get("provider", "Gemini AI")
    }


def generate_presentation(title: str, summary: str, transcript: str = "",
                          force_refresh: bool = False, chain: FallbackChain | None = None) -> Dict[str, Any]:
    key = make_cache_key("presentation", title, summary)
    if force_refresh:
        _cache.pop(key)
    elif (cached := _cache.get(key)) is not None:
        return cached

    prompt = f"TITLE: {title}\n\nSUMMARY:\n{summary}\n\nTRANSCRIPT EXCERPT:\n{transcript[:4000]}"
    try:
        result = (chain or json_chain()).complete(prompt, system=PPT_SYSTEM_PROMPT, json_mode=True)
    except LLMUnavailable as exc:
        logger.warning("%s; using the rule-based fallback.", exc)
        return rule_based_presentation(title, summary)

    parsed = parse_json_safely(result.text, "ppt")
    data = sanitize_presentation_data(parsed, default_title=title or "Video Presentation")
    data["provider"] = ""
    _cache.put(key, data)
    return data


def rule_based_presentation(title: str, summary: str) -> Dict[str, Any]:
    """Slide outline built from the `##` sections of the summary."""
    sections = [s.strip() for s in summary.split("## ") if s.strip()]
    slides = []
    layouts = ["split_left_image", "split_right_image", "cards_right"]
    images = ["photo_classroom_raising_hands.png", "photo_classroom_desks.png", "photo_school_building.png"]
    for idx, sec in enumerate(sections[:6]):
        lines = [l.strip() for l in sec.split("\n") if l.strip()]
        sec_title = lines[0] if lines else "Overview"
        bullets = [l.lstrip("-* ").strip() for l in lines[1:5] if l.startswith("-") or l.startswith("*")]
        if not bullets:
            bullets = [lines[1]] if len(lines) > 1 else ["Key takeaways from section."]
        slides.append({
            "title": sec_title,
            "kicker": f"Topic {idx + 1:02d} • Core Concept",
            "summary": f"In-depth analysis of {sec_title}, exploring its mechanisms, real-world context, and key practical outcomes.",
            "bullets": bullets[:4],
            "layout": layouts[idx % len(layouts)],
            "image_asset": images[idx % len(images)],
            "notes": f"Explanation of {sec_title}.",
        })
    data = sanitize_presentation_data({"title": title or "Video Presentation", "slides": slides},
                                      default_title=title or "Video Presentation")
    data["provider"] = "Rule-based fallback"
    return data


def clear_cache() -> None:
    _cache.clear()
