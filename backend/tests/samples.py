"""Builders for small, real sample files (and some hostile ones)."""
import io
import zipfile


def pdf(text="Hello PDF text"):
    """A tiny valid one-page PDF containing `text`."""
    body = f"BT /F1 18 Tf 20 100 Td ({text}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(body)).encode() + b" >>\nstream\n" + body + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out, offsets = b"%PDF-1.4\n", []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def docx(paragraph="Hello Word text", table_cell="cell value"):
    from docx import Document

    document = Document()
    document.add_paragraph(paragraph)
    table = document.add_table(rows=1, cols=1)
    table.rows[0].cells[0].text = table_cell
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def pptx(title="Hello Slides"):
    from pptx import Presentation

    presentation = Presentation()
    slide = presentation.slides.add_slide(presentation.slide_layouts[5])
    slide.shapes.title.text = title
    buffer = io.BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


def zip_with(files, first_mimetype=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        if first_mimetype:
            archive.writestr(zipfile.ZipInfo("mimetype"), first_mimetype, compress_type=zipfile.ZIP_STORED)
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def xlsx(text: bool = True):
    """A real minimal workbook: one sheet with two text cells and a number."""
    shared = f'<sst xmlns="{SHEET_NS}"><si><t>Quarterly revenue</t></si><si><t>Net margin</t></si></sst>' if text else f'<sst xmlns="{SHEET_NS}"/>'
    sheet = (f'<worksheet xmlns="{SHEET_NS}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row>'
             f'<row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>') if text else f'<worksheet xmlns="{SHEET_NS}"><sheetData/></worksheet>'
    return zip_with({"xl/workbook.xml": "<workbook/>", "[Content_Types].xml": "<Types/>",
                     "xl/sharedStrings.xml": shared, "xl/worksheets/sheet1.xml": sheet})


def odt(text: bool = True):
    body = "<text:p>Odt paragraph words</text:p><text:p>Second odt line</text:p>" if text else ""
    content = ('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
               'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>'
               f'{body}</office:text></office:body></office:document-content>')
    return zip_with({"content.xml": content}, first_mimetype="application/vnd.oasis.opendocument.text")


def zip_bomb_docx():
    """Tiny on disk, enormous when unpacked."""
    return zip_with({"word/document.xml": b"\0" * (12 * 1024 * 1024)})


OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 600
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\0" * 64
GIF = b"GIF89a" + b"\0" * 64
WEBP = b"RIFF\0\0\0\0WEBPVP8 " + b"\0" * 64
RTF = b"{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello rtf world\\par Second rtf line}"
TXT = "Plain text notes — हिन्दी\nsecond line".encode("utf-8")
MD = b"# Heading\n\n- point one\n"
CSV = b"a,b\n1,2\n"

EXE = b"MZ\x90\x00" + b"\0" * 200
HTML = b"<html><script>alert(1)</script></html>"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'

MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\0" * 2000
MOV = b"\x00\x00\x00\x14ftypqt  " + b"\0" * 2000
MKV = b"\x1a\x45\xdf\xa3" + b"\0" * 2000
AVI = b"RIFF\0\0\0\0AVI LIST" + b"\0" * 2000
WAV = b"RIFF\0\0\0\0WAVEfmt " + b"\0" * 2000
MP3 = b"ID3\x03\0\0\0\0\0\0" + b"\0" * 2000
