"""Static, searchable PDFs of the owner's MindNode maps, for GT3 Nutrition's library (R44).

The MindNode maps (content/nutrition/source/mindnode) are read into outlines (content/nutrition/outlines, by
mindnode2md.py, or MindNode's own export when the owner's Mac can make one). This turns each outline into a PDF a reader
downloads to zoom, keep and search — the Rookie board's promise. The words are the owner's, as written; nothing is
added but the masthead and the footer. Run by hand when a map changes:

    python3 content/nutrition/tools/build_maps.py

Writes public/nutrition/maps/<file>.pdf for each map below, and prints each file's size for lib/nutrition MAPS.
"""
import os, re, sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from xml.sax.saxutils import escape

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "public", "nutrition", "maps")
SRC = os.path.join(ROOT, "content", "nutrition", "outlines")

MAPS = [
    ("7-Step Return to Primal (Animal-Based Success", "Go Animal-Based in 7 Steps", "seven-steps-animal-based.pdf"),
    ("Ruminant (RED) Meat Explained", "Ruminant (Red) Meat Explained", "ruminant-meat-explained.pdf"),
    ("Power Carbs Explained", "Power Carbs Explained", "power-carbs-explained.pdf"),
    ("Vitamins and Minerals Explained", "Vitamins and Minerals Explained", "vitamins-minerals-explained.pdf"),
    ("Amino Acids Explained", "Amino Acids Explained", "amino-acids-explained.pdf"),
    ("7-Day System to Break Sugar Cravings", "Break Sugar Cravings in 7 Days", "break-sugar-cravings.pdf"),
]

RED, INK, DIM, GOLD = HexColor("#B82420"), HexColor("#221F18"), HexColor("#5b5446"), HexColor("#86581f")

def fonts():
    base = "/usr/share/fonts/truetype/dejavu/"
    pdfmetrics.registerFont(TTFont("Body", base + "DejaVuSans.ttf"))
    pdfmetrics.registerFont(TTFont("Body-Bold", base + "DejaVuSans-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("Serif-Bold", base + "DejaVuSerif-Bold.ttf"))

def styles():
    eye = ParagraphStyle("eye", fontName="Body-Bold", fontSize=8, leading=11, textColor=GOLD, spaceAfter=4)
    title = ParagraphStyle("title", fontName="Serif-Bold", fontSize=24, leading=28, textColor=INK, spaceAfter=10)
    lv = [ParagraphStyle(f"l{d}", fontName="Body-Bold" if d < 2 else "Body", fontSize=[13, 11.5, 10, 9.5, 9][min(d, 4)],
                         leading=[17, 15, 13.5, 13, 12.5][min(d, 4)], textColor=INK if d < 3 else DIM,
                         leftIndent=d * 14, spaceBefore=[10, 7, 4, 2, 2][min(d, 4)]) for d in range(6)]
    return eye, title, lv

def clean(t):
    t = re.sub(r"\s*/\s*", "\n", t)                       # a map's line breaks
    t = re.sub(r"[\U0001F000-\U0001FFFF☀-➿️]", "", t)   # emoji the font can't draw
    return t.strip()

def footer(c, doc):
    c.saveState()
    c.setFont("Body", 7.5); c.setFillColor(DIM)
    c.drawString(0.75 * inch, 0.5 * inch, "GT3 Nutrition · Return to Primal · Educational, never medical.")
    c.drawRightString(letter[0] - 0.75 * inch, 0.5 * inch, f"© GT3 Nutrition · gt3pb.com · {doc.page}")
    c.restoreState()

def build(src, title, out):
    eye, tstyle, lv = styles()
    lines = open(os.path.join(SRC, src + ".md"), encoding="utf-8").read().splitlines()
    story = [Paragraph("GT3 NUTRITION · RETURN TO PRIMAL", eye), Paragraph(escape(title), tstyle), Spacer(1, 4)]
    for ln in lines:
        m = re.match(r"^(\s*)- (.*)$", ln)
        if not m: continue
        depth = len(m.group(1)) // 2
        text = clean(m.group(2))
        if not text: continue
        story.append(Paragraph(escape(text).replace("\n", "<br/>"), lv[min(depth, 5)]))
    path = os.path.join(OUT, out)
    SimpleDocTemplate(path, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.7 * inch,
                      bottomMargin=0.8 * inch, title=f"GT3 Nutrition — {title}", author="GT3 Nutrition").build(story, onFirstPage=footer, onLaterPages=footer)
    return os.path.getsize(path)

if __name__ == "__main__":
    fonts()
    os.makedirs(OUT, exist_ok=True)
    for src, title, out in MAPS:
        print(out, build(src, title, out))
