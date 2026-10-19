"""Build the editorial pitch PDF, browser deck and detailed speaker script.

Slide content lives in docs/pitch/deck.json. All text remains selectable in the
PDF. Charts use source counts; the city background is a labelled AI illustration.
This exporter does not overwrite the six-slide technical presentation.
"""

from html import escape
import hashlib
import json
import logging
from pathlib import Path
import re
import shutil

from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph

from export_pdf import register_fonts

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output/pitch"
W, H = 1280, 720
INK, PAPER, CYAN, GOLD = "#071E29", "#F3EEE5", "#62E4D2", "#E9BF79"
MUTED, TEAL, CORAL = "#A3B8C0", "#087D78", "#C36D3D"
LOG = logging.getLogger("pitch")


class Pitch:
    """Render named editorial compositions with explicit text-fit checks."""

    def __init__(self, target):
        self.canvas = Canvas(str(target), pagesize=(W, H), invariant=1)
        self.canvas.setTitle("Прогулки по Астане — питч")
        self.canvas.setAuthor("Команда «Прогулки по Астане»")
        self.bounds = []
        self.page = 0
        self.dark = True

    def box(self, x, y, value, size=26, width=1100, color=None, bold=False, height=200, leading=None):
        """Draw native text, rejecting overflow instead of shrinking type."""
        theme = color or (PAPER if self.dark else INK)
        style = ParagraphStyle("pitch", fontName="AstanaBold" if bold else "Astana",
                               fontSize=size, leading=leading or size * 1.18,
                               textColor=HexColor(theme), spaceAfter=0)
        item = Paragraph(escape(str(value)).replace("\n", "<br/>"), style)
        _, actual = item.wrap(width, 10000)
        if actual > height + 1 or x < 0 or x + width > W or y + actual > H - 12:
            raise ValueError(f"Slide {self.page}: text does not fit: {str(value)[:70]}")
        item.drawOn(self.canvas, x, H - y - actual)
        self.bounds.append({"slide": self.page, "text": value, "x": x, "y": y,
                            "width": width, "height": actual, "fontSize": size})
        return actual

    def rect(self, x, y, width, height, color):
        self.canvas.setFillColor(HexColor(color))
        self.canvas.rect(x, H - y - height, width, height, stroke=0, fill=1)

    def begin(self, index, dark=True, hero=False):
        self.page, self.dark = index, dark
        self.rect(0, 0, W, H, INK if dark else PAPER)
        if hero:
            self.canvas.drawImage(ImageReader(str(ROOT / "docs/pitch/assets/astana-night-ai.png")),
                                  0, 0, W, H, mask="auto")
        self.box(70, 680, "Прогулки по Астане", 13, 400, MUTED if dark else TEAL, height=20)
        self.box(1140, 680, f"{index:02d} / 13", 13, 90, MUTED if dark else TEAL, height=20)

    def heading(self, slide, size=62):
        self.box(70, 76, slide["title"], size, 1140, bold=True, height=185, leading=size * 1.06)

    def render(self, slide, index, summary):
        kind = slide["id"]
        self.begin(index, dark=kind not in {"problem", "demo", "rag", "trust", "quality", "pilot"},
                   hero=kind in {"cover", "close"})
        accent = CYAN if self.dark else TEAL
        if kind == "cover":
            self.box(70, 65, "Build with AI 2026 · НИЦ Smart City", 18, 650, GOLD, height=30)
            self.box(70, 170, slide["title"], 88, 750, bold=True, height=220, leading=94)
            self.box(75, 415, slide["subtitle"], 29, 630, height=90)
            self.box(75, 610, "Короткий пеший маршрут из обычного запроса", 19, 650, GOLD, height=55)
            self.box(730, 680, "Художественная AI-иллюстрация", 12, 370, MUTED, height=20)
        elif kind == "problem":
            self.box(70, 116, "90", 220, 450, TEAL, bold=True, height=270)
            self.box(85, 368, "минут", 49, 420, bold=True, height=75)
            self.box(580, 100, slide["question"], 58, 610, bold=True, height=165, leading=64)
            for n, (label, body) in enumerate(slide["items"]):
                y = 315 + n * 100
                self.box(580, y, label, 26, 600, TEAL, bold=True, height=40)
                self.box(580, y + 39, body, 23, 600, height=65)
        elif kind == "product":
            self.heading(slide)
            self.box(70, 287, "«" + slide["quote"] + "»", 39, 1120, GOLD, height=115)
            for n, (label, body) in enumerate(slide["items"]):
                x = 70 + n * 400
                self.box(x, 475, label, 29, 330, CYAN, bold=True, height=45)
                self.box(x, 525, body, 23, 330, height=100)
        elif kind == "demo":
            self.heading(slide)
            self.box(70, 250, slide["place"], 49, 620, bold=True, height=135)
            self.box(70, 407, "Сгенерированная идея", 18, 600, TEAL, bold=True, height=30)
            self.box(70, 445, slide["idea"], 26, 600, height=100)
            self.box(70, 592, slide["origin"], 20, 650, height=50)
            self.box(760, 258, slide["distance"], 75, 430, TEAL, bold=True, height=100)
            self.box(760, 354, f"{slide['walk']} пешком", 33, 430, bold=True, height=55)
            self.box(760, 437, slide["visit"], 57, 430, bold=True, height=80)
            self.box(760, 508, "на посещение (оценка)", 22, 430, height=40)
            self.box(760, 582, slide["hours"], 25, 430, CORAL, bold=True, height=70)
            self.box(70, 645, "Фактический ответ. Источник места: OpenStreetMap way/1460763574", 15, 1120, TEAL, height=25)
        elif kind == "data":
            self.box(70, 76, slide["title"], 56, 620, bold=True, height=150, leading=61)
            self.box(70, 260, f"{summary['total']:,}".replace(",", " "), 148, 570, CYAN, bold=True, height=190)
            self.box(75, 460, "мест в наборе", 26, 530, height=50)
            self.box(75, 520, slide["subtitle"], 24, 530, GOLD, height=75)
            groups = category_groups(summary["byCategory"])
            for n, (label, count) in enumerate(groups):
                y = 185 + n * 73
                self.box(690, y, label, 21, 400, height=35)
                self.box(1120, y - 2, str(count), 26, 100, CYAN, bold=True, height=40)
                self.rect(690, y + 39, 520, 7, "#183C47")
                self.rect(690, y + 39, 520 * count / max(v for _, v in groups), 7, GOLD if n == 0 else CYAN)
            self.box(75, 635, "Собственный автоматический сбор · 19.10.2026", 17, 1100, MUTED, height=30)
        elif kind == "rag":
            self.heading(slide)
            for n, (label, body) in enumerate(slide["items"]):
                x = 70 + n * 300
                self.box(x, 300, f"0{n + 1}", 54, 240, TEAL, bold=True, height=75)
                self.box(x, 394, label, 27, 250, bold=True, height=45)
                self.box(x, 450, body, 22, 250, height=110)
            self.box(70, 602, "Сервер проверяет аргументы и результаты каждого инструмента", 24, 1140, TEAL, height=50)
        elif kind == "walk":
            self.heading(slide)
            self.box(70, 277, "68", 158, 460, CYAN, bold=True, height=195)
            self.box(75, 470, "минут на весь маршрут", 24, 460, height=45)
            self.rect(75, 539, 390 * 23 / 68, 14, CYAN)
            self.rect(75 + 390 * 23 / 68, 539, 390 * 45 / 68, 14, GOLD)
            self.box(75, 573, "23 мин ходьбы\n45 мин посещения", 20, 440, MUTED, height=65)
            for n, (name, leg, visit) in enumerate(slide["stops"]):
                y = 294 + n * 162
                self.box(605, y, f"0{n + 1}", 28, 80, GOLD, bold=True, height=45)
                self.box(700, y - 4, name, 37, 510, bold=True, height=60)
                self.box(700, y + 61, f"{leg}\n{visit}", 22, 510, MUTED, height=65)
            self.box(70, 640, "Пешеходная сеть OSM. Подход к входу не проверен. Часы обеих точек неизвестны.", 17, 1140, MUTED, height=30)
        elif kind == "trust":
            self.heading(slide)
            self.box(70, 290, "Факт источника", 22, 520, TEAL, bold=True, height=35)
            self.box(70, 350, slide["fact"], 35, 520, bold=True, height=145)
            self.box(700, 290, "Сгенерированная идея", 22, 510, CORAL, bold=True, height=35)
            self.box(700, 350, slide["idea"], 34, 510, bold=True, height=145)
            self.box(70, 570, slide["privacy"], 25, 1140, TEAL, height=80)
        elif kind == "proof":
            self.heading(slide)
            for x, value, label in [(70, "2", "Свежих сквозных прогона\nЭкспо и маршрут через mock"),
                                    (700, "1 250", "Векторов OpenAI\nИндекс соответствует датасету")]:
                self.box(x, 279, value, 153, 510, CYAN if x == 70 else GOLD, bold=True, height=190)
                self.box(x, 482, label, 25, 510, height=100)
            self.box(75, 618, "Mock без ключа: лексика. Семантический запрос: OpenAI с ключом.", 22, 1130, MUTED, height=40)
        elif kind == "close":
            self.box(70, 90, slide["title"], 73, 760, bold=True, height=285, leading=80)
            self.box(75, 410, slide["subtitle"], 28, 680, GOLD, height=90)
            for x, name, role in [(75, "Саян", "Агент и интеграция"), (310, "Абылай", "Алгоритмы"), (545, "Адиль", "Данные и материалы")]:
                self.box(x, 580, name, 24, 240, bold=True, height=40)
                self.box(x, 621, role, 17, 240, height=45)
            self.box(790, 680, "Художественная AI-иллюстрация", 11, 330, MUTED, height=20)
        elif kind == "quality":
            self.heading(slide)
            values = [("openingHours", "Часы работы"), ("descriptions", "Описание OSM/Wikidata"),
                      ("wikidataPopularity", "Популярность Wikidata")]
            for n, (key, label) in enumerate(values):
                x = 70 + n * 400
                value = summary[key]
                percentage = f"{value['percent']:.2f}".replace(".", ",") + "%"
                self.box(x, 302, percentage, 76, 350, TEAL, bold=True, height=110)
                self.box(x, 428, label, 24, 350, bold=True, height=75)
                self.box(x, 510, f"{value['count']} из {summary['total']} мест", 23, 350, height=40)
            self.box(70, 592, "Wikidata: 64, включая 45 описаний сетей. OSM: 3. Сбор: 19.10.2026, 17:44 по Астане.", 21, 1140, height=60)
        elif kind == "limits":
            self.heading(slide)
            for n, (label, body) in enumerate(slide["items"]):
                x, y = 70 + (n % 2) * 620, 298 + (n // 2) * 172
                self.box(x, y, label, 27, 510, CYAN, bold=True, height=45)
                self.box(x, y + 55, body, 23, 510, height=100)
            self.box(70, 641, "Starter раскрыт в README. OSM: ODbL. Wikidata: CC0. Собственная модель не обучается.", 16, 1140, MUTED, height=30)
        elif kind == "pilot":
            self.heading(slide)
            for n, (label, body) in enumerate(slide["items"]):
                x = 70 + n * 400
                self.box(x, 302, f"0{n + 1}", 58, 330, TEAL, bold=True, height=80)
                self.box(x, 405, label, 29, 330, bold=True, height=80)
                self.box(x, 502, body, 23, 330, height=110)
            self.box(70, 641, "Предлагаемый следующий этап. Измеренных пользовательских результатов пока нет.", 18, 1140, TEAL, height=30)
        else:
            raise ValueError(f"Unknown slide composition: {kind}")
        self.canvas.showPage()


def category_groups(categories):
    """Aggregate every source category exactly once for the pitch chart."""
    groups = [
        ("Еда и напитки", ["cafe", "restaurant", "fast_food", "bar", "nightclub"]),
        ("Достопримечательности", ["attraction", "monument", "artwork"]),
        ("Парки и площадки", ["park", "garden", "playground"]),
        ("Культура", ["museum", "gallery", "theatre", "cinema", "library"]),
        ("Торговые центры", ["mall"]),
    ]
    used = {key for _, keys in groups for key in keys}
    values = [(label, sum(categories[key] for key in keys)) for label, keys in groups]
    values.append(("Прочие категории", sum(value for key, value in categories.items() if key not in used)))
    if sum(value for _, value in values) != sum(categories.values()):
        raise ValueError("Category totals disagree")
    return values


def speaker_script(deck):
    lines = ["# Питч: подробная речь и источники", "Основная часть: 10 слайдов, целевой хронометраж 6:15.",
             "Слайды 11–13 — для вопросов жюри, в основной тайминг не входят.",
             "Иллюстрация города создана AI и не является фотографией или географической картой."]
    elapsed = 0
    for i, slide in enumerate(deck["slides"], 1):
        duration = slide["seconds"]
        timing = f"{elapsed // 60}:{elapsed % 60:02d}–{(elapsed + duration) // 60}:{(elapsed + duration) % 60:02d}" if duration else "Дополнительный слайд"
        lines += [f"## {i}. {slide['title'].replace(chr(10), ' ')}", f"**{timing}**", slide["note"],
                  "Источники: " + "; ".join(slide["sources"]) + "."]
        elapsed += duration
    if elapsed != deck["targetSeconds"]:
        raise ValueError("Speaker timings do not match the intended pitch duration")
    return "\n\n".join(lines) + "\n"


def browser_deck(pdf, deck, target):
    """Embed the exact native PDF layouts in a keyboard-controlled local viewer."""
    import pymupdf
    document = pymupdf.open(pdf)
    sections = []
    for n, page in enumerate(document):
        svg = page.get_svg_image(text_as_path=True)
        # Inline SVG IDs share one HTML document. Prefix glyph/clip IDs per slide.
        for identifier in set(re.findall(r'\bid="([^"]+)"', svg)):
            prefixed = f"slide{n + 1}-{identifier}"
            svg = svg.replace(f'id="{identifier}"', f'id="{prefixed}"')
            svg = svg.replace(f'#{identifier}"', f'#{prefixed}"').replace(f'#{identifier})', f'#{prefixed})')
        sections.append(f'<section class="slide" data-note="{escape(deck["slides"][n]["note"], quote=True)}">{svg}</section>')
    html = """<!doctype html><html lang="ru"><meta charset="utf-8"><title>Прогулки по Астане — питч</title>
<style>*{box-sizing:border-box}body{margin:0;background:#020d13;color:#dfe9e8;font:16px Arial}
main{height:100vh;display:grid;place-items:center;padding:20px 20px 58px}.slide{display:none;width:min(calc((100vh - 78px)*16/9),calc(100vw - 40px))}.slide.on{display:block}.slide svg{width:100%;height:auto;display:block}
nav{position:fixed;bottom:12px;left:0;right:0;text-align:center}button{border:1px solid #49636c;background:#102c37;color:#f3eee5;padding:8px 14px;margin:0 8px;border-radius:4px;cursor:pointer}#note{display:none;position:fixed;bottom:55px;left:5%;right:5%;background:#102c37f5;padding:24px;line-height:1.6;border:1px solid #62e4d2;max-height:38vh;overflow:auto}#note.on{display:block}#count{display:inline-block;min-width:65px}body:fullscreen main{padding:0}body:fullscreen .slide{width:min(calc(100vh*16/9),100vw)}body:fullscreen nav{opacity:0}body:fullscreen nav:hover{opacity:1}
</style><main>SLIDES</main><aside id="note"></aside><nav><button id="prev" aria-label="Предыдущий слайд">←</button><span id="count"></span><button id="next" aria-label="Следующий слайд">→</button><button id="notes">Заметки (N)</button><button id="full">На весь экран (F)</button></nav>
<script>let i=0;const slides=[...document.querySelectorAll('.slide')],note=document.getElementById('note');function show(n){i=Math.max(0,Math.min(slides.length-1,n));slides.forEach((s,k)=>s.classList.toggle('on',k===i));document.getElementById('count').textContent=(i+1)+' / '+slides.length;note.textContent=slides[i].dataset.note}function notes(){note.classList.toggle('on')}function full(){if(!document.fullscreenElement)document.body.requestFullscreen();else document.exitFullscreen()}document.getElementById('prev').onclick=()=>show(i-1);document.getElementById('next').onclick=()=>show(i+1);document.getElementById('notes').onclick=notes;document.getElementById('full').onclick=full;document.addEventListener('keydown',e=>{if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(i+1)}if(['ArrowLeft','PageUp'].includes(e.key))show(i-1);if(e.key.toLowerCase()==='n')notes();if(e.key.toLowerCase()==='f')full()});show(0)</script></html>"""
    target.write_text(html.replace("SLIDES", "".join(sections)), encoding="utf-8")


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    deck = json.loads((ROOT / "docs/pitch/deck.json").read_text(encoding="utf-8"))
    summary = json.loads((ROOT / "data/collect_summary.json").read_text(encoding="utf-8"))
    qa = json.loads((ROOT / "docs/pitch/runtime-check.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256((ROOT / "data/poi.json").read_bytes()).hexdigest()
    if summary["total"] != 1250 or qa["datasetSha256"] != digest:
        raise ValueError("Pitch snapshot changed; recheck the copy against fresh evidence")
    route = next(record for record in qa["records"] if record["id"] == "route")
    plan = next(tool["result"] for tool in route["result"]["toolCalls"] if tool["name"] == "plan_walk")
    if plan["totalMinutes"] != 68 or plan["walkingRoute"]["status"] != "available":
        raise ValueError("Verified route changed; update pitch and speech")
    register_fonts()
    OUT.mkdir(parents=True, exist_ok=True)
    pdf = OUT / "astana-pitch.pdf"
    pitch = Pitch(pdf)
    for number, slide in enumerate(deck["slides"], 1):
        pitch.render(slide, number, summary)
    pitch.canvas.save()
    (OUT / "layout-check.json").write_text(json.dumps(pitch.bounds, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "docs/pitch/speaker-notes.md").write_text(speaker_script(deck), encoding="utf-8")
    browser_deck(pdf, deck, OUT / "astana-pitch.html")
    shutil.copyfile(pdf, ROOT / "docs/pitch/astana-pitch.pdf")
    LOG.info("Built %d slides; main pitch %d:%02d", len(deck["slides"]), deck["targetSeconds"] // 60, deck["targetSeconds"] % 60)


if __name__ == "__main__":
    main()
