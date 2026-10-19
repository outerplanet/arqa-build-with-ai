"""Build the six-slide PDF and scenario handout from committed project evidence.

Run from the repository root with reportlab installed. Set ASTANA_PDF_FONT_DIR
to a directory containing Arial.ttf and Arial Bold.ttf on non-macOS hosts.
"""

import html
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate


ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = Path(os.environ.get("ASTANA_PDF_FONT_DIR", "/System/Library/Fonts/Supplemental"))
pdfmetrics.registerFont(TTFont("Astana", str(FONT_DIR / "Arial.ttf")))
pdfmetrics.registerFont(TTFont("AstanaBold", str(FONT_DIR / "Arial Bold.ttf")))
pdfmetrics.registerFontFamily("Astana", normal="Astana", bold="AstanaBold", italic="Astana", boldItalic="AstanaBold")

INK = colors.HexColor("#04262D")
ACCENT = colors.HexColor("#007A8F")
MUTED = colors.HexColor("#52656D")
WIDTH, HEIGHT = 960, 540
SUMMARY = json.loads((ROOT / "data/collect_summary.json").read_text())
HTTP_PROBES = json.loads((ROOT / "docs/presentation-http-probes.json").read_text())


def paragraph(text, size=24, color=INK, bold=False):
    return Paragraph(text, ParagraphStyle(
        "slide", fontName="AstanaBold" if bold else "Astana", fontSize=size,
        leading=size * 1.28, textColor=color, alignment=TA_LEFT,
    ))


def draw_text(pdf, text, x, top, width, size=24, color=INK, bold=False):
    item = paragraph(text, size, color, bold)
    _, height = item.wrap(width, HEIGHT)
    if top - height < 48:
        raise ValueError(f"Slide text exceeds content area: {text}")
    item.drawOn(pdf, x, top - height)
    return top - height


def percent(metric):
    return f'{SUMMARY[metric]["percent"]:.2f}%'.replace(".", ",")


def slides():
    total = f'{SUMMARY["total"]:,}'.replace(",", " ")
    collected = datetime.fromisoformat(SUMMARY["collectedAt"].replace("Z", "+00:00"))
    local = collected.astimezone(timezone(timedelta(hours=5))).strftime("%d.%m.%Y %H:%M")
    checked = datetime.fromisoformat(HTTP_PROBES["at"].replace("Z", "+00:00"))
    verified = checked.astimezone(timezone(timedelta(hours=5))).strftime("%d.%m.%Y %H:%M")
    commit = HTTP_PROBES["sourceGitCommit"][:7]
    return [
        ("Прогулки по Астане", [
            "Умный AI-помощник<br/>для пеших маршрутов",
            "Куда сходить рядом,<br/>когда есть свободный час",
        ], "Build with AI 2026 · Кейс НИЦ Smart City · Команда Саяна, Абылая и Адиля"),
        ("Свободный час в городе", [
            "Место должно подходить по интересам, расстоянию и времени работы.",
            "Короткую прогулку приходится собирать из нескольких карточек и карт.",
            "Помощник должен дать до трёх конкретных вариантов и объяснить выбор.",
        ], "Для жителей и гостей Астаны. Пользовательская ценность пока остаётся гипотезой."),
        ("Открытые городские данные", [
            f"<b>{total} POI</b> в выборке именованных мест по Астане.",
            f"Часы работы: <b>{percent('openingHours')}</b>. Описания OSM/Wikidata: <b>{percent('descriptions')}</b>.",
            f"Популярность Wikidata: <b>{percent('wikidataPopularity')}</b>. Это известность по sitelinks, не отзывы.",
            "OSM подтверждает прежнее имя «Музей Нур Алем» у текущего Alem.ai. Часы работы неизвестны.",
        ], f"Сбор: {local} по Астане · © участники OpenStreetMap, ODbL · Wikidata, CC0<br/>openstreetmap.org/copyright · wikidata.org/wiki/Wikidata:Licensing · openstreetmap.org/way/454857501/history"),
        ("RAG и короткий маршрут", [
            "Инструменты: resolve_location, find_places, get_place, plan_walk.",
            "Поиск по POI: лексика, фильтры, расстояние. Скрипт эмбеддингов готов, векторы ожидают ключа.",
            "Маршрут: 2–3 остановки в бюджете ходьбы и посещений. Расстояние по прямой ×1,3.",
            "Временное подключение проверено: реальный маршрут на 79 минут. Обычный API пока использует заглушки.",
        ], "Next.js · Проверка Zod · Статические файлы · Без базы данных и хранения геолокации"),
        ("Демонстрация: запрос у Экспо", [
            "«Я у здания Экспо 2017, хочу что-то необычное на 1–2 часа, пешком». ",
            "Фактический ответ текущего приложения: «Данные мест и алгоритмы поиска ещё не подключены».",
            "Экран: чат и журнал действий есть. Карта, геолокация и карточки POI пока отсутствуют.",
            "Это статус готовности демо. Успешный ответ с картой пока не подтверждён.",
        ], f"Повторная HTTP-проверка: {verified} по Астане · Коммит {commit} · docs/scenarios.md"),
        ("Ответственное AI и Smart City", [
            "У факта есть источник. Сгенерированная идея обозначается явно.",
            "Координаты округляются до трёх знаков, около 100 м. Это не гарантия анонимности.",
            "Нет сведений о погоде, пробках, ценах и доступности тротуаров. Часы могут устареть.",
            "Дальше: подключение компонентов, шесть сценариев, пешеходный граф и пользовательские тесты.",
        ], "Раскрытие: стартовый шаблон · OpenAI · OSM/Wikidata · MapLibre GL/OpenFreeMap для карты"),
    ]


def build_presentation():
    pdf = canvas.Canvas(str(ROOT / "docs/presentation.pdf"), pagesize=(WIDTH, HEIGHT))
    pdf.setTitle("Прогулки по Астане — Build with AI 2026")
    pdf.setAuthor("Команда «Прогулки по Астане»")
    for index, (title, body, footer) in enumerate(slides(), 1):
        draw_text(pdf, f"BUILD WITH AI 2026 / {index:02d}", 54, 505, 850, 12, ACCENT, True)
        top = draw_text(pdf, title, 54, 465, 850, 44 if index == 1 else 34, INK, True) - 25
        for item in body:
            top = draw_text(pdf, item, 54, top, 835, 30 if index == 1 else 23) - 18
        item = paragraph(html.escape(footer).replace("&lt;br/&gt;", "<br/>"), 10.5, MUTED)
        _, height = item.wrap(825, 45)
        if height > 40:
            raise ValueError("Slide footer is too tall")
        item.drawOn(pdf, 54, 22)
        pdf.setFont("Astana", 11)
        pdf.setFillColor(MUTED)
        pdf.drawRightString(910, 24, f"{index} / 6")
        pdf.showPage()
    pdf.save()


def rich(text):
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    return text


def build_scenarios():
    styles = {
        "title": ParagraphStyle("title", fontName="AstanaBold", fontSize=23, leading=28, textColor=INK, spaceAfter=16),
        "heading": ParagraphStyle("heading", fontName="AstanaBold", fontSize=15, leading=19, textColor=ACCENT, spaceBefore=15, spaceAfter=9, keepWithNext=True),
        "body": ParagraphStyle("body", fontName="Astana", fontSize=10.5, leading=14.5, textColor=INK, spaceAfter=6),
        "fact": ParagraphStyle("fact", fontName="Astana", fontSize=10.5, leading=14.5, textColor=INK, spaceAfter=6, keepWithNext=True),
        "sequence": ParagraphStyle("sequence", fontName="Astana", fontSize=10.5, leading=14.5, textColor=INK, spaceAfter=6, keepWithNext=True),
        "quote": ParagraphStyle("quote", fontName="Astana", fontSize=10.5, leading=14.5, textColor=ACCENT, leftIndent=15, spaceAfter=8, keepWithNext=True),
    }
    blocks = re.split(r"\n\s*\n", (ROOT / "docs/scenarios.md").read_text().strip())
    content = []
    for block in blocks:
        if block.startswith("# "):
            content.append(Paragraph(rich(block[2:]), styles["title"]))
        elif block.startswith("## "):
            content.append(Paragraph(rich(block[3:]), styles["heading"]))
        elif block.startswith("> "):
            content.append(Paragraph(rich(block.replace("\n", " ")[2:]), styles["quote"]))
        elif block.startswith("**Фактически"):
            content.append(Paragraph(rich(block.replace("\n", " ")), styles["fact"]))
        elif block.startswith("- ") or re.match(r"\d+\. ", block):
            # Keep wrapped list items together, splitting at explicit Markdown item starts.
            items = re.split(r"\n(?=- |\d+\. )", block)
            ordered = bool(re.match(r"\d+\. ", block))
            for index, item in enumerate(items):
                style = styles["sequence"] if ordered and index < len(items) - 1 else styles["body"]
                content.append(Paragraph(rich(item.replace("\n", " ")), style))
        else:
            content.append(Paragraph(rich(block.replace("\n", " ")), styles["body"]))
    document = SimpleDocTemplate(str(ROOT / "docs/scenarios.pdf"), pagesize=A4,
        rightMargin=45, leftMargin=45, topMargin=42, bottomMargin=42,
        title="Прогулки по Астане: тестовые сценарии и ограничения", author="Адиль / команда проекта")

    def footer(pdf, doc):
        pdf.saveState()
        pdf.setFont("Astana", 8)
        pdf.setFillColor(MUTED)
        pdf.drawString(45, 24, "Прогулки по Астане / Тестовые сценарии и ограничения")
        pdf.drawRightString(A4[0] - 45, 24, str(doc.page))
        pdf.restoreState()

    document.build(content, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build_presentation()
    build_scenarios()
    print("Created docs/presentation.pdf and docs/scenarios.pdf")
