#!/usr/bin/env python3
"""Builds the Phase 4 test corpus in tests/corpus (DOCX, XLSX, PDF, PPTX) plus reference outputs from independent tools:
python-docx / openpyxl / pdftotext for text, and LibreOffice for reference PDFs and cached spreadsheet values.
Run: python3 -I scripts/make-corpus.py   (needs python-docx, openpyxl, python-pptx, reportlab, pypdf, Pillow, LibreOffice, poppler)."""
import copy, datetime, json, os, random, shutil, subprocess, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "tests" / "corpus"
FX = ROOT / "tests" / "fixtures"
TMP = OUT / ".tmp"
OUT.mkdir(parents=True, exist_ok=True)
TMP.mkdir(exist_ok=True)
random.seed(7)

LOREM = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
         "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ")

def soffice(args, cwd):
    subprocess.run(["soffice", "--headless", "--norestore", *args], cwd=cwd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)

# ---------------------------------------------------------------- DOCX
def make_docx():
    import docx
    from docx.enum.section import WD_ORIENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement, parse_xml
    from docx.oxml.ns import nsdecls, qn
    from docx.shared import Inches, Pt, RGBColor

    def add_link(par, text, url):
        rid = par.part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
        h = OxmlElement("w:hyperlink"); h.set(qn("r:id"), rid)
        r = OxmlElement("w:r"); t = OxmlElement("w:t"); t.text = text; r.append(t); h.append(r)
        par._p.append(h)

    def page_field(par):
        par._p.append(parse_xml(f'<w:fldSimple {nsdecls("w")} w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'))

    # simple
    d = docx.Document()
    d.core_properties.title = "Simple Report"; d.core_properties.author = "Corpus Author"
    d.add_heading("Simple Report", 1)
    p = d.add_paragraph("This paragraph has ")
    p.add_run("bold").bold = True; p.add_run(", "); p.add_run("italic").italic = True; p.add_run(", "); p.add_run("underlined").underline = True
    r = p.add_run(" and red text."); r.font.color.rgb = RGBColor(0xC0, 0, 0)
    add_link(d.add_paragraph("Visit "), "the example site", "https://example.com/")
    d.add_heading("Lists", 2)
    for t in ["First bullet", "Second bullet", "Third bullet"]: d.add_paragraph(t, style="List Bullet")
    for t in ["Step one", "Step two", "Step three"]: d.add_paragraph(t, style="List Number")
    d.add_heading("A table", 2)
    t = d.add_table(rows=4, cols=3); t.style = "Table Grid"
    for c, h in enumerate(["Item", "Qty", "Price"]):
        cell = t.rows[0].cells[c]; cell.text = ""; cell.paragraphs[0].add_run(h).bold = True
    for i, row in enumerate([("Widget", "4", "12.50"), ("Gadget", "10", "7.25"), ("Gizmo", "1", "199.99")], 1):
        for c, v in enumerate(row): t.rows[i].cells[c].text = v
    d.add_paragraph(LOREM * 3)
    d.save(OUT / "docx-simple.docx")

    # complex
    d = docx.Document()
    d.core_properties.title = "Complex Document"; d.core_properties.author = "Corpus Author"; d.core_properties.subject = "Corpus"
    sec = d.sections[0]
    sec.left_margin = sec.right_margin = Inches(0.75)
    sec.header.paragraphs[0].text = "Complex Document Header"
    fp = sec.footer.paragraphs[0]; fp.text = "Confidential - page "; page_field(fp)
    st = d.styles["Normal"]; st.font.name = "Times New Roman"; st.font.size = Pt(12)
    d.add_paragraph("Complex Document", style="Title")
    d.add_heading("1 Introduction", 1)
    for al, label in [(WD_ALIGN_PARAGRAPH.CENTER, "Centered paragraph"), (WD_ALIGN_PARAGRAPH.RIGHT, "Right aligned paragraph"), (WD_ALIGN_PARAGRAPH.JUSTIFY, "Justified paragraph. " + LOREM)]:
        d.add_paragraph(label).alignment = al
    d.add_heading("1.1 Nested lists", 2)
    d.add_paragraph("Top level A", style="List Bullet"); d.add_paragraph("Second level A1", style="List Bullet 2"); d.add_paragraph("Third level A1a", style="List Bullet 3")
    d.add_paragraph("Top level B", style="List Bullet")
    d.add_paragraph("Numbered one", style="List Number"); d.add_paragraph("Numbered two", style="List Number")
    d.add_paragraph("Quoted text goes here.", style="Quote")
    d.add_heading("1.2 Pictures", 2)
    d.add_picture(str(FX / "opaque.png"), width=Inches(3)); d.add_picture(str(FX / "photo.jpg"), width=Inches(2.5))
    d.add_page_break()
    d.add_heading("2 Tables", 1)
    t = d.add_table(rows=3, cols=4); t.style = "Table Grid"
    t.cell(0, 0).merge(t.cell(0, 1)); t.cell(0, 0).text = "Merged header"; t.cell(0, 2).text = "C"; t.cell(0, 3).text = "D"
    for r in (1, 2):
        for c in range(4): t.cell(r, c).text = f"r{r}c{c}"
    nested = t.cell(2, 3).add_table(rows=1, cols=2); nested.cell(0, 0).text = "n1"; nested.cell(0, 1).text = "n2"
    d.add_heading("3 Special content", 1)
    # tracked changes
    p = d.add_paragraph("Before ")
    p._p.append(parse_xml(f'<w:ins {nsdecls("w")} w:id="1" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:t>inserted text</w:t></w:r></w:ins>'))
    p._p.append(parse_xml(f'<w:del {nsdecls("w")} w:id="2" w:author="A" w:date="2024-01-01T00:00:00Z"><w:r><w:delText>deleted text</w:delText></w:r></w:del>'))
    p.add_run(" after.")
    # text box (VML)
    p = d.add_paragraph("Paragraph with a text box:")
    p._p.append(parse_xml(f'<w:r {nsdecls("w")} xmlns:v="urn:schemas-microsoft-com:vml"><w:pict><v:shape type="#_x0000_t202" style="width:100pt;height:40pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Text inside the box</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r>'))
    d.add_paragraph("Unicode: Здраво свету — Македонија ќ ѓ љ њ џ ѕ. Ελληνικά café Łódź €5.")
    # landscape last section
    new = d.add_section(); new.orientation = WD_ORIENT.LANDSCAPE; new.page_width, new.page_height = new.page_height, new.page_width
    d.add_paragraph("Landscape section text. " + LOREM)
    d.save(OUT / "docx-complex.docx")

    # long (about 40 pages)
    d = docx.Document(); d.core_properties.title = "Long Document"
    for i in range(1, 61):
        d.add_heading(f"Chapter {i}", 1 if i % 10 == 1 else 2)
        for j in range(4): d.add_paragraph(f"[{i}.{j}] " + LOREM * 3)
    d.save(OUT / "docx-long.docx")

    # unicode
    d = docx.Document()
    d.add_heading("Unicode sample", 1)
    d.add_paragraph("Македонски: Скопје, Охрид, ќе, ѓубре, љубов, њива, џеб, ѕвезда.")
    d.add_paragraph("Ελληνικά: Αθήνα, Θεσσαλονίκη. Latin: café, Łódź, Ünïcödé, ñ, ß, €, £.")
    d.add_paragraph("CJK sample: 中文日本語한국어 and Arabic: مرحبا بالعالم and Hebrew: שלום עולם")
    d.save(OUT / "docx-unicode.docx")

    # malformed
    data = (OUT / "docx-simple.docx").read_bytes()
    (OUT / "docx-truncated.docx").write_bytes(data[: len(data) // 2])
    (OUT / "docx-notzip.docx").write_bytes(b"This is plain text renamed to .docx\n" * 20)
    with zipfile.ZipFile(OUT / "docx-nodocument.docx", "w") as z: z.writestr("[Content_Types].xml", "<Types/>"); z.writestr("hello.txt", "hi")
    with zipfile.ZipFile(OUT / "docx-badxml.docx", "w") as z: z.writestr("word/document.xml", "<w:document><w:body><w:p>")
    # zip bomb: 80 MB of valid XML inside a few KB
    with zipfile.ZipFile(OUT / "docx-bomb.docx", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + " " * (80 * 1024 * 1024) + "</w:t></w:r></w:p></w:body></w:document>")

# ---------------------------------------------------------------- XLSX
def make_xlsx():
    import openpyxl
    from openpyxl.chart import BarChart, Reference
    from openpyxl.drawing.image import Image as XImage
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.properties import PageSetupProperties

    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Sales"
    ws.append(["Region", "Date", "Units", "Revenue", "Share", "Note"])
    base = datetime.date(2024, 1, 15)
    for i in range(12):
        ws.append([["North", "South", "East", "West"][i % 4], base + datetime.timedelta(days=i * 17), 100 + i * 13, 1234.5 * (i + 1), (i + 1) / 100, f"row {i}"])
    for r in range(2, 14):
        ws.cell(r, 2).number_format = "yyyy-mm-dd"; ws.cell(r, 4).number_format = "#,##0.00"; ws.cell(r, 5).number_format = "0.0%"
    ws["H1"] = "Total"; ws["H2"] = "=SUM(D2:D13)"; ws["H2"].number_format = '"$"#,##0.00'
    ws.column_dimensions["A"].width = 14; ws.column_dimensions["F"].width = 22
    wb.save(TMP / "xlsx-simple.xlsx")

    wb = openpyxl.Workbook()
    a = wb.active; a.title = "Overview"
    a.append(["Quarter", "Revenue", "Cost", "Profit"])
    for q in range(1, 5): a.append([f"Q{q}", 1000 * q, 600 * q, f"=B{q+1}-C{q+1}"])
    a.merge_cells("F1:G2"); a["F1"] = "Merged cell"
    a.row_dimensions[3].hidden = True; a.column_dimensions["C"].hidden = False
    chart = BarChart(); chart.add_data(Reference(a, min_col=2, min_row=1, max_row=5), titles_from_data=True); a.add_chart(chart, "A8")
    b = wb.create_sheet("Detail")
    b.append(["Id", "Name", "Amount", "When"])
    for i in range(1, 31): b.append([i, f"Item {i}", i * 19.99, datetime.datetime(2024, 3, 1, 9, 30) + datetime.timedelta(hours=i * 7)])
    b.print_area = "A1:C10"
    for r in range(2, 32): b.cell(r, 3).number_format = "#,##0.00"; b.cell(r, 4).number_format = "d mmm yyyy h:mm AM/PM"
    c = wb.create_sheet("Hidden"); c.append(["secret"]); c.sheet_state = "hidden"
    wb.save(TMP / "xlsx-multi.xlsx")

    wb = openpyxl.Workbook(); w = wb.active; w.title = "Wide"
    w.append([f"Col{c}" for c in range(30)])
    for r in range(20): w.append([f"v{r}_{c}" if c % 3 == 0 else r * c + 0.5 for c in range(30)])
    wb.save(OUT / "xlsx-wide.xlsx")

    wb = openpyxl.Workbook(); w = wb.active; w.title = "Too wide"
    w.append([f"C{c}" for c in range(60)]); w.append(list(range(60)))
    wb.save(OUT / "xlsx-too-wide.xlsx")

    wb = openpyxl.Workbook(); w = wb.active; w.title = "Long"
    w.append(["Id", "Name", "Amount"])
    for i in range(1, 5001): w.append([i, f"Customer {i}", round(i * 3.17, 2)])
    wb.save(OUT / "xlsx-long.xlsx")

    wb = openpyxl.Workbook(); w = wb.active; w.title = "Unicode"
    w.append(["Име", "Град", "Ελληνικά"]); w.append(["Јован", "Скопје", "Αθήνα"]); w.append(["Zoë", "Łódź", "café"])
    wb.save(OUT / "xlsx-unicode.xlsx")

    wb = openpyxl.Workbook(); w = wb.active; w.title = "NoCache"
    w.append(["A", "B"]); w.append([1, "=A2*2"])
    wb.save(OUT / "xlsx-formula-nocache.xlsx")

    data = (OUT / "xlsx-wide.xlsx").read_bytes()
    (OUT / "xlsx-truncated.xlsx").write_bytes(data[: len(data) // 2])
    (OUT / "xlsx-notzip.xlsx").write_bytes(b"a,b,c\n1,2,3\n")
    with zipfile.ZipFile(OUT / "xlsx-bomb.xlsx", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", "<worksheet><sheetData>" + "<row><c><v>1</v></c></row>" * 5_000_000 + "</sheetData></worksheet>")

    # Recalculate with LibreOffice so formulas have cached values (as a spreadsheet app would save them).
    for name in ["xlsx-simple", "xlsx-multi"]:
        soffice(["--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(OUT), str(TMP / f"{name}.xlsx")], str(TMP))

# ---------------------------------------------------------------- PDF
def make_pdf():
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import BaseDocTemplate, Frame, ListFlowable, ListItem, PageTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, FrameBreak
    from reportlab.lib import colors
    from reportlab.pdfgen import canvas as rl_canvas

    ss = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=ss["Normal"], fontName="Times-Roman", fontSize=11, leading=15)
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=22, leading=26)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=15, leading=19)

    def decorate(c, doc):
        c.saveState(); c.setFont("Helvetica", 8)
        c.drawString(72, A4[1] - 40, "Corpus running header"); c.drawCentredString(A4[0] / 2, 30, f"Page {doc.page}")
        c.restoreState()

    def build(path, flow, title="Corpus PDF", two_col=False):
        doc = BaseDocTemplate(str(path), pagesize=A4, title=title, author="Corpus Author", leftMargin=72, rightMargin=72, topMargin=72, bottomMargin=72)
        if two_col:
            w = (A4[0] - 144 - 24) / 2
            frames = [Frame(72, 72, w, A4[1] - 144, id="l"), Frame(72 + w + 24, 72, w, A4[1] - 144, id="r")]
        else:
            frames = [Frame(72, 72, A4[0] - 144, A4[1] - 144, id="f")]
        doc.addPageTemplates([PageTemplate(id="p", frames=frames, onPage=decorate)])
        doc.build(flow)

    flow = [Paragraph("Quarterly Overview", h1), Paragraph("This document was generated for the conversion corpus. " + LOREM * 2, body), Spacer(1, 8),
            Paragraph("Key points", h2),
            ListFlowable([ListItem(Paragraph(t, body)) for t in ["First bullet point with some words", "Second bullet point that is long enough to wrap onto a second line of text in the page", "Third bullet"]], bulletType="bullet", start="•"),
            Spacer(1, 6), Paragraph("<b>Bold lead-in.</b> Followed by <i>italic text</i> and normal text. " + LOREM, body), Spacer(1, 8), Paragraph("Results", h2)]
    tbl = Table([["Region", "Units", "Revenue"], ["North", "120", "4,500.00"], ["South", "98", "3,975.50"], ["East", "143", "5,120.25"], ["West", "77", "2,310.00"]], colWidths=[150, 100, 120])
    tbl.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.5, colors.grey)]))
    flow += [tbl, Spacer(1, 12)]
    for i in range(14): flow.append(Paragraph(f"Section paragraph {i}. " + LOREM * 2, body))
    flow += [Paragraph("Conclusion", h2), Paragraph("Final words. " + LOREM, body), PageBreak(), Paragraph("Appendix", h2), Paragraph("Appendix body text. " + LOREM * 3, body)]
    build(OUT / "pdf-text-simple.pdf", flow)

    build(OUT / "pdf-two-column.pdf", [Paragraph("Two Column Article", h1)] + [Paragraph(f"Column paragraph {i}. " + LOREM * 2, body) for i in range(16)], two_col=True)

    longflow = []
    for i in range(1, 121):
        longflow += [Paragraph(f"Part {i}", h2), Paragraph(f"[{i}] " + LOREM * 4, body), Paragraph(LOREM * 4, body), PageBreak()]
    build(OUT / "pdf-long.pdf", longflow)

    c = rl_canvas.Canvas(str(OUT / "pdf-links.pdf"), pagesize=A4)
    c.setFont("Helvetica", 12); c.drawString(72, 760, "Visit the example website for details."); c.linkURL("https://example.com/", (72 + 60, 755, 72 + 160, 772)); c.save()

    # scanned: a page that only contains a picture of text
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1240, 1754), "white"); dr = ImageDraw.Draw(im)
    for i in range(30): dr.text((100, 100 + i * 40), f"Scanned line {i}: " + LOREM[:60], fill="black")
    im.save(OUT / "pdf-scanned.pdf", "PDF", resolution=150)

    # protected
    from pypdf import PdfReader, PdfWriter
    wr = PdfWriter(); [wr.add_page(p) for p in PdfReader(str(OUT / "pdf-text-simple.pdf")).pages[:1]]; wr.encrypt("secret"); wr.write(str(OUT / "pdf-encrypted.pdf"))

    data = (OUT / "pdf-text-simple.pdf").read_bytes()
    (OUT / "pdf-truncated.pdf").write_bytes(data[: len(data) // 3])
    (OUT / "pdf-notpdf.pdf").write_bytes(b"not a pdf at all\n" * 40)

    # LibreOffice-produced PDF (realistic export of the complex Word file)
    soffice(["--convert-to", "pdf", "--outdir", str(OUT), str(OUT / "docx-complex.docx")], str(TMP))
    shutil.move(OUT / "docx-complex.pdf", OUT / "pdf-from-libreoffice.pdf")

# ---------------------------------------------------------------- PPTX (feasibility only; never converted by the app)
def make_pptx():
    from pptx import Presentation
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE
    from pptx.util import Inches, Pt
    p = Presentation()
    s = p.slides.add_slide(p.slide_layouts[0]); s.shapes.title.text = "Deck Title"; s.placeholders[1].text = "Subtitle text"
    s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text = "Agenda"
    tf = s.placeholders[1].text_frame; tf.text = "First topic"
    for t in ["Second topic", "Third topic"]: tf.add_paragraph().text = t
    p.save(OUT / "pptx-simple.pptx")
    p = Presentation()
    s = p.slides.add_slide(p.slide_layouts[5]); s.shapes.title.text = "Chart slide"
    cd = CategoryChartData(); cd.categories = ["A", "B", "C"]; cd.add_series("S", (1, 2, 3))
    s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(1.5), Inches(6), Inches(4), cd)
    s = p.slides.add_slide(p.slide_layouts[6]); s.shapes.add_picture(str(FX / "opaque.png"), Inches(1), Inches(1), Inches(4))
    tb = s.shapes.add_textbox(Inches(1), Inches(5), Inches(5), Inches(1)); tb.text_frame.text = "Free text box on a picture slide"
    s = p.slides.add_slide(p.slide_layouts[5]); s.shapes.title.text = "Table slide"
    tbl = s.shapes.add_table(3, 3, Inches(1), Inches(2), Inches(6), Inches(2)).table
    for r in range(3):
        for c in range(3): tbl.cell(r, c).text = f"{r},{c}"
    s.notes_slide.notes_text_frame.text = "Speaker notes live here"
    p.save(OUT / "pptx-complex.pptx")

# ---------------------------------------------------------------- references
def references():
    import docx, openpyxl
    from docx.document import Document as _D
    ref = {}
    def docx_text(path):
        d = docx.Document(str(path)); out = []
        W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
        def ptext(p):
            return "".join(t.text or "" for t in p.iter() if t.tag == W + "t")
        def walk(container):
            for ch in container.iterchildren():
                if ch.tag == W + "p":
                    out.append(ptext(ch))
                elif ch.tag == W + "tbl":
                    for tr in ch.iterchildren(W + "tr"):
                        for tc in tr.iterchildren(W + "tc"):
                            walk(tc)
        walk(d.element.body)
        return "\n".join(x for x in out if x.strip())
    for f in ["docx-simple", "docx-complex", "docx-long", "docx-unicode"]:
        (OUT / f"{f}.ref.txt").write_text(docx_text(OUT / f"{f}.docx"), encoding="utf-8")
        soffice(["--convert-to", "pdf", "--outdir", str(TMP), str(OUT / f"{f}.docx")], str(TMP))
        shutil.copy(TMP / f"{f}.pdf", OUT / f"{f}.ref.pdf")
    for f in ["xlsx-simple", "xlsx-multi", "xlsx-wide", "xlsx-unicode"]:
        soffice(["--convert-to", "pdf", "--outdir", str(TMP), str(OUT / f"{f}.xlsx")], str(TMP))
        shutil.copy(TMP / f"{f}.pdf", OUT / f"{f}.ref.pdf")
    # pdftotext orders newspaper columns by coordinates, which is not the reading order; the true order is the source order.
    (OUT / "pdf-two-column.ref.txt").write_text("Two Column Article\n" + "\n".join(f"Column paragraph {i}. " + LOREM * 2 for i in range(16)), encoding="utf-8")
    for f in ["pdf-text-simple", "pdf-long", "pdf-from-libreoffice", "pdf-links"]:
        txt = subprocess.run(["pdftotext", str(OUT / f"{f}.pdf"), "-"], capture_output=True, text=True).stdout
        (OUT / f"{f}.ref.txt").write_text(txt, encoding="utf-8")
    for f in ["pptx-simple", "pptx-complex"]:
        from pptx import Presentation
        out = []
        for s in Presentation(str(OUT / f"{f}.pptx")).slides:
            for sh in s.shapes:
                if sh.has_text_frame: out.append(sh.text_frame.text)
        (OUT / f"{f}.ref.txt").write_text("\n".join(out), encoding="utf-8")

if __name__ == "__main__":
    make_docx(); make_xlsx(); make_pdf(); make_pptx(); references()
    shutil.rmtree(TMP, ignore_errors=True)
    for p in sorted(OUT.iterdir()): print(f"{p.stat().st_size:>10}  {p.name}")
