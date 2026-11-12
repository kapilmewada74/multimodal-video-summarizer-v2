"""Reading the text out of documents (best effort; the file is kept either way)."""
import logging
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger("summarizer.documents")

MAX_TEXT_CHARS = 500_000
MAX_PDF_PAGES = 300
TEXT_EXTENSIONS = {".txt", ".md", ".csv"}
OPENDOCUMENT = {".odt", ".odp", ".ods"}
EXTRACTABLE = TEXT_EXTENSIONS | OPENDOCUMENT | {".pdf", ".docx", ".pptx", ".xlsx", ".rtf"}


def _clip(text: str) -> str:
    return text[:MAX_TEXT_CHARS]


def _pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path), strict=False)
    if reader.is_encrypted and not reader.decrypt(""):
        raise ValueError("encrypted")
    parts, size = [], 0
    for page in reader.pages[:MAX_PDF_PAGES]:
        text = page.extract_text() or ""
        parts.append(text)
        size += len(text)
        if size > MAX_TEXT_CHARS:
            break
    return "\n\n".join(parts)


def _docx(path: Path) -> str:
    from docx import Document

    document = Document(str(path))
    lines = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                lines.append(" | ".join(cells))
    return "\n".join(lines)


def _pptx(path: Path) -> str:
    from pptx import Presentation

    parts = []
    for number, slide in enumerate(Presentation(str(path)).slides, start=1):
        texts = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False) and shape.text_frame.text.strip():
                texts.append(shape.text_frame.text.strip())
        if texts:
            parts.append(f"Slide {number}\n" + "\n".join(texts))
    return "\n\n".join(parts)


def _xml_text(data: bytes) -> str:
    """All the text in an XML part, one block per paragraph-like element."""
    import re
    from xml.etree import ElementTree

    root = ElementTree.fromstring(data)  # the zip was already checked to be small and safe
    out, buffer = [], []
    block_tags = ("}p", "}h", "}tab-row", "}table-row", "}list-item", "}row")
    for element in root.iter():
        tag = element.tag if isinstance(element.tag, str) else ""
        if element.text and element.text.strip():
            buffer.append(element.text.strip())
        if tag.endswith(block_tags) and buffer:
            out.append(" ".join(buffer))
            buffer = []
        if element.tail and element.tail.strip():
            buffer.append(element.tail.strip())
    if buffer:
        out.append(" ".join(buffer))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out))


def _opendocument(path: Path) -> str:
    import zipfile

    with zipfile.ZipFile(path) as archive:
        return _xml_text(archive.read("content.xml"))


def _xlsx(path: Path) -> str:
    """Cell text from every sheet, one row per line."""
    import zipfile
    from xml.etree import ElementTree

    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            for si in ElementTree.fromstring(archive.read("xl/sharedStrings.xml")).iter(ns + "si"):
                shared.append("".join(t.text or "" for t in si.iter(ns + "t")))
        sheets = sorted(n for n in names if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
        parts = []
        for number, name in enumerate(sheets[:20], start=1):
            rows = []
            for row in ElementTree.fromstring(archive.read(name)).iter(ns + "row"):
                cells = []
                for cell in row.iter(ns + "c"):
                    value = cell.find(ns + "v")
                    if value is None or value.text is None:
                        inline = cell.find(ns + "is")
                        text = "".join(t.text or "" for t in inline.iter(ns + "t")) if inline is not None else ""
                    elif cell.get("t") == "s":
                        index = int(value.text)
                        text = shared[index] if 0 <= index < len(shared) else ""
                    else:
                        text = value.text
                    if text.strip():
                        cells.append(text.strip())
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                parts.append(f"Sheet {number}\n" + "\n".join(rows))
    return "\n\n".join(parts)


def _rtf(path: Path) -> str:
    """Plain text from an RTF file: drop groups we do not show, control words and braces."""
    import re

    with open(path, "rb") as handle:
        raw = handle.read(MAX_TEXT_CHARS * 4).decode("latin-1", errors="replace")
    raw = re.sub(r"\{\\\*[^{}]*\}", "", raw)                       # {\* ...} destinations
    raw = re.sub(r"\{\\(fonttbl|colortbl|stylesheet|info)[^{}]*(\{[^{}]*\}[^{}]*)*\}", "", raw)
    raw = raw.replace("\\par", "\n").replace("\\tab", "\t")
    raw = re.sub(r"\\'([0-9a-fA-F]{2})", lambda m: bytes.fromhex(m.group(1)).decode("cp1252", "replace"), raw)
    raw = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", raw)                      # control words
    raw = re.sub(r"\\[^a-zA-Z]", "", raw)
    return re.sub(r"[{}]", "", raw)


def _plain(path: Path) -> str:
    with open(path, "rb") as handle:
        return handle.read(MAX_TEXT_CHARS * 4).decode("utf-8-sig", errors="replace")


def extract_text(path: Path, ext: str) -> Tuple[str, Optional[str]]:
    """Returns (status, text): 'extracted', 'none' (nothing readable or a format we do not read)
    or 'failed' (the file is damaged or locked)."""
    if ext not in EXTRACTABLE:
        return "none", None
    try:
        reader = {".pdf": _pdf, ".docx": _docx, ".pptx": _pptx, ".xlsx": _xlsx, ".rtf": _rtf,
                  ".odt": _opendocument, ".odp": _opendocument, ".ods": _opendocument}.get(ext, _plain)
        text = _clip(reader(path)).replace("\x00", "").strip()
    except Exception as exc:
        logger.info("Could not read %s: %s", ext, type(exc).__name__)
        return "failed", None
    return ("extracted", text) if text else ("none", None)
