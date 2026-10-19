"""Export actual Markdown through Pandoc's AST to slide and A4 PDFs.

Install scripts/pdf-requirements.txt in a venv, then run this file. Each H1 in
presentation.md starts a slide; HTML comments are editable speaker notes.
ReportLab renders the Pandoc AST without embedding any document copy in Python.
"""

from __future__ import annotations

import argparse
from html import escape
import json
import logging
import os
from pathlib import Path
import shutil
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
LOG = logging.getLogger("export_pdf")


def parse_markdown(path: Path) -> list[dict]:
    """Parse Markdown with bundled Pandoc; reject missing/empty sources."""
    import pypandoc

    if not path.is_file():
        raise ValueError(f"Missing Markdown source: {path}")
    LOG.info("Parsing %s with Pandoc", path)
    document = json.loads(pypandoc.convert_text(path.read_text(encoding="utf-8"),
                         "json", format="markdown", extra_args=["--standalone"]))
    if not document["blocks"]:
        raise ValueError(f"Empty Markdown source: {path}")
    return document["blocks"]


def inline(nodes: list[dict]) -> str:
    """Convert Pandoc inlines to safe ReportLab markup, failing on data loss."""
    result = []
    for node in nodes:
        kind, content = node["t"], node.get("c")
        if kind == "Str":
            result.append(escape(content))
        elif kind in {"Space", "SoftBreak"}:
            result.append(" ")
        elif kind == "LineBreak":
            result.append("<br/>")
        elif kind in {"Strong", "Emph", "Strikeout", "SmallCaps", "Underline"}:
            tag = {"Strong": "b", "Emph": "i", "Strikeout": "strike"}.get(kind)
            rendered = inline(content)
            result.append(f"<{tag}>{rendered}</{tag}>" if tag else rendered)
        elif kind in {"Code", "Math"}:
            result.append(escape(content[1]))
        elif kind == "Link":
            result.append(f'<a href="{escape(content[2][0], quote=True)}" color="#007A8F">{inline(content[1])}</a>')
        elif kind == "Span":
            result.append(inline(content[1]))
        elif kind == "Quoted":
            result.append("«" + inline(content[1]) + "»")
        else:
            raise ValueError(f"Unsupported Markdown inline: {kind}")
    return "".join(result)


def register_fonts() -> None:
    """Find local Cyrillic-capable fonts; no network font dependency."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    candidates = ([Path(os.environ["ASTANA_PDF_FONT_DIR"])]
                  if os.environ.get("ASTANA_PDF_FONT_DIR") else []) + [
        Path("/System/Library/Fonts/Supplemental"),
        Path("/usr/share/fonts/truetype/dejavu"), Path("C:/Windows/Fonts")]
    for directory in candidates:
        for regular, bold in [("Arial.ttf", "Arial Bold.ttf"),
                              ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf"),
                              ("arial.ttf", "arialbd.ttf")]:
            if (directory / regular).is_file() and (directory / bold).is_file():
                pdfmetrics.registerFont(TTFont("Astana", str(directory / regular)))
                pdfmetrics.registerFont(TTFont("AstanaBold", str(directory / bold)))
                pdfmetrics.registerFontFamily("Astana", normal="Astana", bold="AstanaBold",
                                             italic="Astana", boldItalic="AstanaBold")
                return
    raise ValueError("Cyrillic font missing. Set ASTANA_PDF_FONT_DIR to a directory with "
                     "Arial.ttf + Arial Bold.ttf or DejaVuSans.ttf + DejaVuSans-Bold.ttf")


def styles(slides=False):
    from reportlab.lib.styles import ParagraphStyle

    size = 23 if slides else 10
    return {
        "body": ParagraphStyle("body", fontName="Astana", fontSize=size,
            leading=size * 1.35, spaceAfter=14 if slides else 7, textColor="#193C44"),
        "heading": ParagraphStyle("heading", fontName="AstanaBold", fontSize=32 if slides else 15,
            leading=39 if slides else 20, spaceBefore=10, spaceAfter=22 if slides else 10,
            keepWithNext=True, textColor="#007A8F"),
        "small": ParagraphStyle("small", fontName="Astana", fontSize=9,
            leading=12, textColor="#52656D", spaceAfter=5),
    }


def flowables(blocks, theme, width):
    """Render prose, lists, quotes, code, tables and comments from Pandoc AST."""
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle

    result = []
    for node in blocks:
        kind, content = node["t"], node.get("c")
        if kind in {"Para", "Plain"}:
            result.append(Paragraph(inline(content), theme["body"]))
        elif kind == "Header":
            result.append(Paragraph(inline(content[2]), theme["heading"]))
        elif kind in {"BulletList", "OrderedList"}:
            items = content if kind == "BulletList" else content[1]
            start = 1 if kind == "BulletList" else content[0][0]
            for index, item in enumerate(items, start):
                children = flowables(item, theme, width - 18)
                if children and isinstance(children[0], Paragraph):
                    children[0].bulletText = "•" if kind == "BulletList" else f"{index}."
                result.extend(children)
        elif kind in {"BlockQuote", "Div"}:
            result.extend(flowables(content if kind == "BlockQuote" else content[1], theme, width))
        elif kind == "CodeBlock":
            for line in content[1].splitlines():
                result.append(Paragraph(escape(line) or "&#160;", theme["small"]))
        elif kind == "Table":
            # Pandoc table: attributes, caption, columns, head, bodies, foot.
            rows = list(content[3][1])
            for body in content[4]:
                rows.extend(body[2])
                rows.extend(body[3])
            rows.extend(content[5][1])
            cells = [[flowables(cell[4], {**theme, "body": theme["small"]}, width)
                      for cell in row[1]] for row in rows]
            if cells:
                table = Table(cells, colWidths=[width / len(cells[0])] * len(cells[0]),
                              repeatRows=1 if content[3][1] else 0, hAlign="LEFT")
                table.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.6, "#007A8F"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
                result.extend([table, Spacer(1, 8)])
        elif kind == "HorizontalRule":
            result.append(Spacer(1, 12))
        elif kind == "RawBlock" and content[0] == "html" and content[1].strip().startswith("<!--"):
            continue  # Speaker notes remain editable in Markdown.
        else:
            raise ValueError(f"Unsupported Markdown block: {kind}; use text, lists or tables")
    return result


def build_slides(blocks, target):
    """Each H1 starts a slide; overflowing content fails the build."""
    from reportlab.pdfgen.canvas import Canvas

    sections = []
    for block in blocks:
        if block["t"] == "Header" and block["c"][0] == 1:
            sections.append((block, []))
        elif sections:
            sections[-1][1].append(block)
        else:
            raise ValueError("Presentation must start with an H1 heading; each H1 starts a slide")
    if not sections:
        raise ValueError("Presentation has no slides")
    canvas = Canvas(str(target), pagesize=(960, 540), invariant=1)
    canvas.setTitle("Прогулки по Астане: презентация")
    for number, (heading, body) in enumerate(sections, 1):
        canvas.setFillColorRGB(0.985, 0.993, 0.994)
        canvas.rect(0, 0, 960, 540, fill=1, stroke=0)
        canvas.setFillColorRGB(0, 0.478, 0.561)
        canvas.setFont("AstanaBold", 11)
        canvas.drawString(54, 508, "BUILD WITH AI 2026 / ASTANA")
        top = 474
        for item in flowables([heading, *body], styles(True), 852):
            _, height = item.wrap(852, 450)
            top -= item.getSpaceBefore()
            if top - height < 52:
                raise ValueError(f"Slide {number} overflows: shorten Markdown or move text to <!-- notes -->")
            item.drawOn(canvas, 54, top - height)
            top -= height + item.getSpaceAfter()
        canvas.setFont("Astana", 10)
        canvas.setFillColorRGB(0.32, 0.40, 0.43)
        canvas.drawString(54, 24, "Прогулки по Астане · открытые городские данные")
        canvas.drawRightString(906, 24, f"{number} / {len(sections)}")
        canvas.showPage()
    canvas.save()
    LOG.info("Wrote %s (%d slides)", target, len(sections))


def build_handout(blocks, target):
    """Paginate scenario Markdown on A4 with repeating table headers."""
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate

    def footer(canvas, document):
        canvas.setFont("Astana", 9)
        canvas.drawString(42, 24, "Прогулки по Астане · сценарии и ограничения")
        canvas.drawRightString(A4[0] - 42, 24, str(document.page))

    document = SimpleDocTemplate(str(target), pagesize=A4, leftMargin=42,
        rightMargin=42, topMargin=38, bottomMargin=42,
        title="Прогулки по Астане: сценарии", invariant=1)
    document.build(flowables(blocks, styles(), A4[0] - 84),
                   onFirstPage=footer, onLaterPages=footer)
    LOG.info("Wrote %s", target)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--no-compat-copies", action="store_true",
                        help="Do not copy PDFs into docs/ for existing submission links")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    output = args.output_dir or args.root / "output/pdf"
    try:
        source = {name: parse_markdown(args.root / f"docs/{name}.md")
                  for name in ("presentation", "scenarios")}
        register_fonts()
        output.mkdir(parents=True, exist_ok=True)
        # Stage both PDFs so a failed build cannot replace old deliverables.
        with TemporaryDirectory(prefix="astana-pdf-", dir=output) as staging:
            stage = Path(staging)
            build_slides(source["presentation"], stage / "presentation.pdf")
            build_handout(source["scenarios"], stage / "scenarios.pdf")
            for name in source:
                shutil.copyfile(stage / f"{name}.pdf", output / f"{name}.pdf")
                if not args.no_compat_copies:
                    shutil.copyfile(stage / f"{name}.pdf", args.root / f"docs/{name}.pdf")
        return 0
    except ImportError as error:
        LOG.error("Missing PDF dependency %s. Install: python -m pip install -r scripts/pdf-requirements.txt", error.name)
    except (ValueError, OSError, RuntimeError) as error:
        LOG.error("PDF export failed: %s", error)
    return 1


if __name__ == "__main__":
    sys.exit(main())
