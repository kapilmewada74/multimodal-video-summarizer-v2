"""Builds the downloadable PowerPoint (.pptx) file."""
from typing import Any, Dict, Optional

from ...core.config import get_settings


def build_pptx_file(presentation_data: Dict[str, Any], output_path: Optional[str] = None) -> bytes:
    """Generate professional 16:9 widescreen PPTX file with template branding."""
    import io
    import os
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.enum.shapes import MSO_SHAPE

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    blank_layout = prs.slide_layouts[6]

    title_text = presentation_data.get("title", "Lecture Summary")
    slides_data = presentation_data.get("slides", [])
    template = presentation_data.get("template", "warm_hexagons")

    templates_dir = get_settings().assets_dir / "templates"
    tmpl_dir_hexagons = str(templates_dir / "warm_hexagons")
    tmpl_dir_editorial = str(templates_dir / "modern_editorial")

    has_editorial = (
        template == "modern_editorial"
        and os.path.exists(tmpl_dir_editorial)
    )

    f_first = os.path.join(tmpl_dir_hexagons, "slide_first.png")
    f_body = os.path.join(tmpl_dir_hexagons, "slide_body.png")
    f_last = os.path.join(tmpl_dir_hexagons, "slide_last.png")

    has_hexagons = (
        template == "warm_hexagons"
        and os.path.exists(f_first)
        and os.path.exists(f_body)
        and os.path.exists(f_last)
    )

    if has_editorial:
        # ========================================================
        # TEMPLATE 2: Modern Editorial Navy (Sample 2 Archetypes)
        # ========================================================
        COLOR_NAVY = RGBColor(27, 57, 93)      # #1B395D
        COLOR_BLACK = RGBColor(0, 0, 0)        # #000000
        COLOR_WHITE = RGBColor(255, 255, 255)  # #FFFFFF
        COLOR_CHARCOAL = RGBColor(45, 55, 72)  # #2D3748
        COLOR_MUTED = RGBColor(74, 85, 104)    # #4A5568

        def add_editorial_footer(slide, deck_title, page_str):
            bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(6.8), Inches(13.333), Inches(0.7))
            bar.fill.solid()
            bar.fill.fore_color.rgb = COLOR_NAVY
            bar.line.fill.background()
            
            tb_l = slide.shapes.add_textbox(Inches(0.6), Inches(6.85), Inches(8.0), Inches(0.6))
            tf_l = tb_l.text_frame
            tf_l.word_wrap = False
            p_l = tf_l.paragraphs[0]
            p_l.text = deck_title
            p_l.font.name = "Arial"
            p_l.font.size = Pt(11)
            p_l.font.bold = True
            p_l.font.color.rgb = COLOR_WHITE
            
            tb_r = slide.shapes.add_textbox(Inches(10.5), Inches(6.85), Inches(2.2), Inches(0.6))
            tf_r = tb_r.text_frame
            tf_r.word_wrap = False
            p_r = tf_r.paragraphs[0]
            p_r.text = page_str
            p_r.alignment = PP_ALIGN.RIGHT
            p_r.font.name = "Arial"
            p_r.font.size = Pt(11)
            p_r.font.bold = True
            p_r.font.color.rgb = COLOR_WHITE

        # 1. Slide 0: Cover Slide (Clean Editorial Layout — Image Free)
        s0 = prs.slides.add_slide(blank_layout)
        top_bar = s0.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.12))
        top_bar.fill.solid()
        top_bar.fill.fore_color.rgb = COLOR_NAVY
        top_bar.line.fill.background()

        first_kicker = slides_data[0].get("kicker", "Core Lecture & Keynote") if slides_data else "Core Lecture & Keynote"
        tb_kicker = s0.shapes.add_textbox(Inches(0.85), Inches(0.9), Inches(8.0), Inches(0.5))
        tf_kicker = tb_kicker.text_frame
        p_k = tf_kicker.paragraphs[0]
        p_k.text = first_kicker
        p_k.font.name = "Arial"
        p_k.font.size = Pt(13)
        p_k.font.bold = True
        p_k.font.color.rgb = COLOR_MUTED

        tb_t = s0.shapes.add_textbox(Inches(0.85), Inches(1.5), Inches(6.8), Inches(3.6))
        tf_t = tb_t.text_frame
        tf_t.word_wrap = True
        p_t = tf_t.paragraphs[0]
        p_t.text = title_text.upper()
        p_t.font.name = "Arial"
        p_t.font.size = Pt(38)
        p_t.font.bold = True
        p_t.font.color.rgb = COLOR_BLACK

        # Executive Briefing Box (Replaces Cover Image)
        box_sum = s0.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(7.5), Inches(2.2), Inches(5.1), Inches(3.6))
        box_sum.fill.solid()
        box_sum.fill.fore_color.rgb = COLOR_WHITE
        box_sum.line.color.rgb = RGBColor(220, 224, 232)

        tb_tag = s0.shapes.add_textbox(Inches(7.8), Inches(2.4), Inches(4.5), Inches(0.4))
        p_tag = tb_tag.text_frame.paragraphs[0]
        p_tag.text = "EXECUTIVE BRIEFING"
        p_tag.font.name = "Arial"
        p_tag.font.size = Pt(11)
        p_tag.font.bold = True
        p_tag.font.color.rgb = COLOR_NAVY

        first_summary = slides_data[0].get("summary", "A comprehensive structured lecture synthesizing core principles, real-world context, and key practical takeaways.") if slides_data else "A comprehensive structured lecture synthesizing core principles, real-world context, and key practical takeaways."
        tb_sum = s0.shapes.add_textbox(Inches(7.8), Inches(3.0), Inches(4.5), Inches(2.6))
        tf_sum = tb_sum.text_frame
        tf_sum.word_wrap = True
        p_sum = tf_sum.paragraphs[0]
        p_sum.text = first_summary
        p_sum.font.name = "Arial"
        p_sum.font.size = Pt(13)
        p_sum.font.color.rgb = COLOR_CHARCOAL

        add_editorial_footer(s0, title_text, "Page 01")

        # 2. Slide 1 to N: Content Archetypes (Clean Image-Free Vector Architecture)
        layouts = ["split_left_image", "split_right_image", "cards_right"]

        for idx, slide_info in enumerate(slides_data, start=1):
            s = prs.slides.add_slide(blank_layout)
            layout = slide_info.get("layout")
            if layout not in layouts:
                layout = layouts[(idx - 1) % len(layouts)]

            page_num_str = f"Page {idx + 1:02d}"

            # Top accent line on every slide
            top_bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.12))
            top_bar.fill.solid()
            top_bar.fill.fore_color.rgb = COLOR_NAVY
            top_bar.line.fill.background()

            if layout == "split_left_image":
                tb_k = s.shapes.add_textbox(Inches(0.85), Inches(0.8), Inches(5.2), Inches(0.4))
                tf_k = tb_k.text_frame
                pk = tf_k.paragraphs[0]
                pk.text = slide_info.get("kicker", f"Topic {idx:02d}")
                pk.font.name = "Arial"
                pk.font.size = Pt(13)
                pk.font.bold = True
                pk.font.color.rgb = COLOR_MUTED

                tb_tit = s.shapes.add_textbox(Inches(0.85), Inches(1.2), Inches(5.2), Inches(1.2))
                tf_tit = tb_tit.text_frame
                tf_tit.word_wrap = True
                ptit = tf_tit.paragraphs[0]
                ptit.text = slide_info.get("title", f"Slide {idx}").upper()
                ptit.font.name = "Arial"
                ptit.font.size = Pt(26)
                ptit.font.bold = True
                ptit.font.color.rgb = COLOR_BLACK

                # Left Editorial Focus Card (Replaces Photo)
                box_c = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.85), Inches(2.6), Inches(5.2), Inches(3.7))
                box_c.fill.solid()
                box_c.fill.fore_color.rgb = COLOR_WHITE
                box_c.line.color.rgb = COLOR_NAVY

                tb_c_tag = s.shapes.add_textbox(Inches(1.1), Inches(2.8), Inches(4.7), Inches(0.4))
                pc_tag = tb_c_tag.text_frame.paragraphs[0]
                pc_tag.text = "CORE PRINCIPLE & FORMULATION"
                pc_tag.font.name = "Arial"
                pc_tag.font.size = Pt(11)
                pc_tag.font.bold = True
                pc_tag.font.color.rgb = COLOR_NAVY

                tb_c_txt = s.shapes.add_textbox(Inches(1.1), Inches(3.3), Inches(4.7), Inches(2.6))
                tfc_txt = tb_c_txt.text_frame
                tfc_txt.word_wrap = True
                pc_txt = tfc_txt.paragraphs[0]
                pc_txt.text = slide_info.get("summary", "") or slide_info.get("title", "")
                pc_txt.font.name = "Arial"
                pc_txt.font.size = Pt(13)
                pc_txt.font.color.rgb = COLOR_BLACK

                # Right Side: Contrast Grey Panel with Bullets
                panel_r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.5), Inches(0.12), Inches(6.833), Inches(6.68))
                panel_r.fill.solid()
                panel_r.fill.fore_color.rgb = RGBColor(222, 222, 224)
                panel_r.line.fill.background()

                tb_b = s.shapes.add_textbox(Inches(7.1), Inches(1.2), Inches(5.5), Inches(5.0))
                tf_b = tb_b.text_frame
                tf_b.word_wrap = True
                bullets = slide_info.get("bullets", [])
                for b_idx, bullet in enumerate(bullets[:4]):
                    bp = tf_b.paragraphs[0] if b_idx == 0 else tf_b.add_paragraph()
                    bp.text = f"•  {bullet}"
                    bp.font.name = "Arial"
                    bp.font.size = Pt(13)
                    bp.font.color.rgb = COLOR_BLACK
                    bp.space_before = Pt(16)

                add_editorial_footer(s, title_text, page_num_str)

            elif layout == "split_right_image":
                tb_tit = s.shapes.add_textbox(Inches(0.85), Inches(0.8), Inches(5.6), Inches(1.1))
                tf_tit = tb_tit.text_frame
                tf_tit.word_wrap = True
                ptit = tf_tit.paragraphs[0]
                ptit.text = slide_info.get("title", f"Slide {idx}").upper()
                ptit.font.name = "Arial"
                ptit.font.size = Pt(26)
                ptit.font.bold = True
                ptit.font.color.rgb = COLOR_BLACK

                tb_k = s.shapes.add_textbox(Inches(0.85), Inches(1.9), Inches(5.6), Inches(0.4))
                tf_k = tb_k.text_frame
                pk = tf_k.paragraphs[0]
                pk.text = slide_info.get("kicker", f"Topic {idx:02d}")
                pk.font.name = "Arial"
                pk.font.size = Pt(14)
                pk.font.bold = True
                pk.font.color.rgb = COLOR_BLACK

                tb_sum = s.shapes.add_textbox(Inches(0.85), Inches(2.3), Inches(5.6), Inches(1.3))
                tf_sum = tb_sum.text_frame
                tf_sum.word_wrap = True
                psum = tf_sum.paragraphs[0]
                psum.text = slide_info.get("summary", "")
                psum.font.name = "Arial"
                psum.font.size = Pt(12)
                psum.font.color.rgb = COLOR_CHARCOAL

                bullets = slide_info.get("bullets", [])
                for b_idx, bullet in enumerate(bullets[:4]):
                    y_pos = Inches(3.7 + b_idx * 0.68)
                    badge = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.85), y_pos, Inches(0.35), Inches(0.35))
                    badge.fill.solid()
                    badge.fill.fore_color.rgb = COLOR_NAVY
                    badge.line.fill.background()
                    btf = badge.text_frame
                    btf.vertical_anchor = MSO_ANCHOR.MIDDLE
                    bp = btf.paragraphs[0]
                    bp.alignment = PP_ALIGN.CENTER
                    bp.text = f"{b_idx+1:02d}"
                    bp.font.name = "Arial"
                    bp.font.size = Pt(10)
                    bp.font.bold = True
                    bp.font.color.rgb = COLOR_WHITE

                    tb_txt = s.shapes.add_textbox(Inches(1.35), y_pos - Inches(0.06), Inches(5.1), Inches(0.5))
                    tft = tb_txt.text_frame
                    tft.word_wrap = True
                    pt = tft.paragraphs[0]
                    pt.text = bullet
                    pt.font.name = "Arial"
                    pt.font.size = Pt(12)
                    pt.font.color.rgb = COLOR_BLACK

                # Right Side: Deep Navy Framework Card (Replaces Photo)
                box_r = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(6.8), Inches(0.8), Inches(5.7), Inches(5.5))
                box_r.fill.solid()
                box_r.fill.fore_color.rgb = COLOR_NAVY
                box_r.line.fill.background()

                tb_r_tag = s.shapes.add_textbox(Inches(7.1), Inches(1.1), Inches(5.1), Inches(0.4))
                pr_tag = tb_r_tag.text_frame.paragraphs[0]
                pr_tag.text = "ANALYTICAL FRAMEWORK"
                pr_tag.font.name = "Arial"
                pr_tag.font.size = Pt(11)
                pr_tag.font.bold = True
                pr_tag.font.color.rgb = RGBColor(217, 236, 149)

                tb_r_tit = s.shapes.add_textbox(Inches(7.1), Inches(1.6), Inches(5.1), Inches(1.0))
                tfr_tit = tb_r_tit.text_frame
                tfr_tit.word_wrap = True
                pr_tit = tfr_tit.paragraphs[0]
                pr_tit.text = slide_info.get("title", "").upper()
                pr_tit.font.name = "Arial"
                pr_tit.font.size = Pt(20)
                pr_tit.font.bold = True
                pr_tit.font.color.rgb = COLOR_WHITE

                tb_r_sum = s.shapes.add_textbox(Inches(7.1), Inches(2.8), Inches(5.1), Inches(3.0))
                tfr_sum = tb_r_sum.text_frame
                tfr_sum.word_wrap = True
                pr_sum = tfr_sum.paragraphs[0]
                pr_sum.text = slide_info.get("summary", "")
                pr_sum.font.name = "Arial"
                pr_sum.font.size = Pt(13)
                pr_sum.font.color.rgb = RGBColor(240, 243, 248)

                add_editorial_footer(s, title_text, page_num_str)

            else:  # cards_right
                # Left Side: Contrast Grey Overview Panel (Replaces Photo)
                panel_l = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0.12), Inches(5.8), Inches(6.68))
                panel_l.fill.solid()
                panel_l.fill.fore_color.rgb = RGBColor(222, 222, 224)
                panel_l.line.fill.background()

                box_brief = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.85), Inches(0.8), Inches(4.4), Inches(1.8))
                box_brief.fill.solid()
                box_brief.fill.fore_color.rgb = COLOR_WHITE
                box_brief.line.color.rgb = RGBColor(200, 204, 212)

                tb_br_tag = s.shapes.add_textbox(Inches(1.05), Inches(0.95), Inches(4.0), Inches(0.35))
                pbr_tag = tb_br_tag.text_frame.paragraphs[0]
                pbr_tag.text = "EXECUTIVE BRIEFING"
                pbr_tag.font.name = "Arial"
                pbr_tag.font.size = Pt(11)
                pbr_tag.font.bold = True
                pbr_tag.font.color.rgb = COLOR_NAVY

                tb_br_k = s.shapes.add_textbox(Inches(1.05), Inches(1.35), Inches(4.0), Inches(1.0))
                tfbr_k = tb_br_k.text_frame
                tfbr_k.word_wrap = True
                pbr_k = tfbr_k.paragraphs[0]
                pbr_k.text = slide_info.get("kicker", "Core Strategy")
                pbr_k.font.name = "Arial"
                pbr_k.font.size = Pt(13)
                pbr_k.font.bold = True
                pbr_k.font.color.rgb = COLOR_BLACK

                tb_sum = s.shapes.add_textbox(Inches(0.85), Inches(2.9), Inches(4.4), Inches(3.2))
                tf_sum = tb_sum.text_frame
                tf_sum.word_wrap = True
                psum = tf_sum.paragraphs[0]
                psum.text = slide_info.get("summary", "")
                psum.font.name = "Arial"
                psum.font.size = Pt(13)
                psum.font.color.rgb = COLOR_CHARCOAL

                # Right Side: Navy Banner Cards
                sq = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.2), Inches(0.88), Inches(0.22), Inches(0.22))
                sq.fill.solid()
                sq.fill.fore_color.rgb = COLOR_NAVY
                sq.line.fill.background()

                tb_tit = s.shapes.add_textbox(Inches(6.55), Inches(0.8), Inches(6.0), Inches(0.9))
                tf_tit = tb_tit.text_frame
                tf_tit.word_wrap = True
                ptit = tf_tit.paragraphs[0]
                ptit.text = slide_info.get("title", f"Slide {idx}").upper()
                ptit.font.name = "Arial"
                ptit.font.size = Pt(24)
                ptit.font.bold = True
                ptit.font.color.rgb = COLOR_BLACK

                bullets = slide_info.get("bullets", [])
                for b_idx, bullet in enumerate(bullets[:4]):
                    card = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.2), Inches(1.85 + b_idx * 1.08), Inches(6.3), Inches(0.82))
                    card.fill.solid()
                    card.fill.fore_color.rgb = COLOR_NAVY
                    card.line.fill.background()
                    ctf = card.text_frame
                    ctf.vertical_anchor = MSO_ANCHOR.MIDDLE
                    ctf.margin_left = Inches(0.25)
                    cp = ctf.paragraphs[0]
                    cp.text = f"{b_idx+1:02d}    {bullet}"
                    cp.font.name = "Arial"
                    cp.font.size = Pt(12)
                    cp.font.bold = True
                    cp.font.color.rgb = COLOR_WHITE

                add_editorial_footer(s, title_text, page_num_str)

            notes_text = slide_info.get("notes", "")
            if notes_text:
                s.notes_slide.notes_text_frame.text = notes_text

        # 3. Last Slide (Thank You)
        s_last = prs.slides.add_slide(blank_layout)
        bg_cover = os.path.join(tmpl_dir_editorial, "bg_cover.png")
        if os.path.exists(bg_cover):
            s_last.shapes.add_picture(bg_cover, Inches(0), Inches(0), width=prs.slide_width, height=prs.slide_height)

        tb_k_last = s_last.shapes.add_textbox(Inches(0.85), Inches(1.2), Inches(6.0), Inches(0.5))
        tf_k_last = tb_k_last.text_frame
        p_kl = tf_k_last.paragraphs[0]
        p_kl.text = "Summary & Key Takeaways"
        p_kl.font.name = "Arial"
        p_kl.font.size = Pt(13)
        p_kl.font.bold = True
        p_kl.font.color.rgb = COLOR_MUTED

        tb_last = s_last.shapes.add_textbox(Inches(0.85), Inches(1.8), Inches(6.8), Inches(1.8))
        tf_last = tb_last.text_frame
        p_last = tf_last.paragraphs[0]
        p_last.text = "THANK YOU"
        p_last.font.name = "Arial"
        p_last.font.size = Pt(46)
        p_last.font.bold = True
        p_last.font.color.rgb = COLOR_BLACK

        tb_sum_last = s_last.shapes.add_textbox(Inches(0.85), Inches(3.6), Inches(6.8), Inches(1.8))
        tf_sum_last = tb_sum_last.text_frame
        tf_sum_last.word_wrap = True
        p_sl = tf_sum_last.paragraphs[0]
        p_sl.text = f"Key takeaways and strategic conclusions for: {title_text}"
        p_sl.font.name = "Arial"
        p_sl.font.size = Pt(14)
        p_sl.font.color.rgb = COLOR_CHARCOAL

        add_editorial_footer(s_last, title_text, f"Page {len(slides_data) + 2:02d}")

    elif has_hexagons:
        # ========================================================
        # TEMPLATE 1: Warm Earthy Hexagons (Sample 1)
        # ========================================================
        COLOR_TITLE = RGBColor(59, 34, 19)      # Warm dark chocolate
        COLOR_SUBTITLE = RGBColor(92, 68, 54)   # Warm bronze brown
        COLOR_BODY = RGBColor(66, 55, 48)       # Readable dark charcoal-brown

        # 1. First Slide (Title)
        s1 = prs.slides.add_slide(blank_layout)
        s1.shapes.add_picture(f_first, Inches(0), Inches(0), width=prs.slide_width, height=prs.slide_height)

        tb1 = s1.shapes.add_textbox(Inches(0.85), Inches(3.8), Inches(7.5), Inches(2.5))
        tf1 = tb1.text_frame
        tf1.word_wrap = True
        p1 = tf1.paragraphs[0]
        p1.text = title_text
        p1.font.name = "Georgia"
        p1.font.size = Pt(36)
        p1.font.bold = True
        p1.font.color.rgb = COLOR_TITLE
        p1.alignment = PP_ALIGN.LEFT

        p1_sub = tf1.add_paragraph()
        p1_sub.text = "KEY TAKEAWAYS & EXECUTIVE SUMMARY"
        p1_sub.font.name = "Arial"
        p1_sub.font.size = Pt(13)
        p1_sub.font.bold = True
        p1_sub.font.color.rgb = COLOR_SUBTITLE
        p1_sub.space_before = Pt(14)

        # 2. Content Slides
        for idx, slide_info in enumerate(slides_data, start=1):
            s = prs.slides.add_slide(blank_layout)
            s.shapes.add_picture(f_body, Inches(0), Inches(0), width=prs.slide_width, height=prs.slide_height)

            # Header Title Box
            h_box = s.shapes.add_textbox(Inches(0.85), Inches(1.5), Inches(7.8), Inches(1.2))
            htf = h_box.text_frame
            htf.word_wrap = True
            hp = htf.paragraphs[0]
            hp.text = slide_info.get("title", f"Slide {idx}")
            hp.font.name = "Georgia"
            hp.font.size = Pt(30)
            hp.font.bold = True
            hp.font.color.rgb = COLOR_TITLE

            # Content Bullets Box
            b_box = s.shapes.add_textbox(Inches(0.85), Inches(2.7), Inches(7.8), Inches(4.2))
            btf = b_box.text_frame
            btf.word_wrap = True
            bullets = slide_info.get("bullets", [])
            for b_idx, bullet in enumerate(bullets):
                bp = btf.paragraphs[0] if b_idx == 0 else btf.add_paragraph()
                bp.text = f"•  {bullet}"
                bp.font.name = "Arial"
                bp.font.size = Pt(16)
                bp.font.color.rgb = COLOR_BODY
                bp.space_before = Pt(12)

            # Speaker Notes
            notes_text = slide_info.get("notes", "")
            if notes_text:
                s.notes_slide.notes_text_frame.text = notes_text

        # 3. Last Slide (Thank You)
        s_last = prs.slides.add_slide(blank_layout)
        s_last.shapes.add_picture(f_last, Inches(0), Inches(0), width=prs.slide_width, height=prs.slide_height)

        tb_last = s_last.shapes.add_textbox(Inches(0.85), Inches(4.2), Inches(6.8), Inches(2.2))
        tf_last = tb_last.text_frame
        tf_last.word_wrap = True
        p_last = tf_last.paragraphs[0]
        p_last.text = "Thank you"
        p_last.font.name = "Georgia"
        p_last.font.size = Pt(46)
        p_last.font.bold = True
        p_last.font.color.rgb = COLOR_TITLE

        p_last_sub = tf_last.add_paragraph()
        p_last_sub.text = f"Key takeaways & insights on: {title_text}"
        p_last_sub.font.name = "Arial"
        p_last_sub.font.size = Pt(13)
        p_last_sub.font.bold = False
        p_last_sub.font.color.rgb = COLOR_SUBTITLE
        p_last_sub.space_before = Pt(12)

    else:
        # ========================================================
        # TEMPLATE 2: Modern Dark (Classic Midnight Lime)
        # ========================================================
        BRAND_BLACK = RGBColor(14, 15, 12)       # #0E0F0C
        BRAND_LIME = RGBColor(217, 236, 149)     # #D9EC95
        TEXT_WHITE = RGBColor(242, 242, 240)     # #F2F2F0

        # Title Slide
        slide = prs.slides.add_slide(blank_layout)
        bg = slide.background
        fill = bg.fill
        fill.solid()
        fill.fore_color.rgb = BRAND_BLACK

        tx_box = slide.shapes.add_textbox(Inches(1.0), Inches(2.2), Inches(11.333), Inches(3.0))
        tf = tx_box.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.text = title_text
        p.font.size = Pt(44)
        p.font.bold = True
        p.font.color.rgb = BRAND_LIME
        p.alignment = PP_ALIGN.LEFT

        p2 = tf.add_paragraph()
        p2.text = "Multimodal Video Summary & Lecture Deck"
        p2.font.size = Pt(20)
        p2.font.color.rgb = TEXT_WHITE
        p2.space_before = Pt(14)

        # Content Slides
        for idx, slide_info in enumerate(slides_data, start=1):
            s = prs.slides.add_slide(blank_layout)
            bg = s.background
            fill = bg.fill
            fill.solid()
            fill.fore_color.rgb = BRAND_BLACK

            header_box = s.shapes.add_textbox(Inches(1.0), Inches(0.8), Inches(11.333), Inches(1.2))
            htf = header_box.text_frame
            htf.word_wrap = True
            hp = htf.paragraphs[0]
            hp.text = f"{idx}. {slide_info.get('title', 'Slide')}"
            hp.font.size = Pt(28)
            hp.font.bold = True
            hp.font.color.rgb = BRAND_LIME

            bullets_box = s.shapes.add_textbox(Inches(1.0), Inches(2.2), Inches(11.333), Inches(4.5))
            btf = bullets_box.text_frame
            btf.word_wrap = True
            bullets = slide_info.get("bullets", [])
            for b_idx, bullet in enumerate(bullets):
                bp = btf.paragraphs[0] if b_idx == 0 else btf.add_paragraph()
                bp.text = f"•  {bullet}"
                bp.font.size = Pt(18)
                bp.font.color.rgb = TEXT_WHITE
                bp.space_before = Pt(16)

            notes_text = slide_info.get("notes", "")
            if notes_text:
                s.notes_slide.notes_text_frame.text = notes_text

    if output_path:
        prs.save(output_path)
        with open(output_path, "rb") as f:
            return f.read()

    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()
