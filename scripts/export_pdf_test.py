"""End-to-end exporter checks; run with python -m unittest scripts/export_pdf_test.py."""

from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

EXPORTER = Path(__file__).with_name("export_pdf.py")


class ExportPdfTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "docs").mkdir()
        self.write("presentation", "# Тестовый слайд\n\nНастоящий текст из Markdown.\n")
        self.write("scenarios", "# Проверка\n\n| Поле | Значение |\n|---|---|\n| Часы | Неизвестны |\n")

    def write(self, name, source):
        (self.root / f"docs/{name}.md").write_text(source, encoding="utf-8")

    def export(self):
        return subprocess.run([sys.executable, str(EXPORTER), "--root", str(self.root)],
                              capture_output=True, text=True, check=False)

    def test_real_markdown_changes_pdf_and_notes_do_not(self):
        self.assertEqual(self.export().returncode, 0)
        target = self.root / "output/pdf/presentation.pdf"
        before = target.read_bytes()
        self.write("presentation", "# Тестовый слайд\n\nИзменённый текст из Markdown.\n")
        self.assertEqual(self.export().returncode, 0)
        after = target.read_bytes()
        self.assertNotEqual(before, after)
        self.write("presentation", "# Тестовый слайд\n\nИзменённый текст из Markdown.\n\n<!-- Заметки докладчика -->\n")
        self.assertEqual(self.export().returncode, 0)
        self.assertEqual(after, target.read_bytes())
        self.assertEqual(after, (self.root / "docs/presentation.pdf").read_bytes())

    def test_missing_source_has_actionable_error(self):
        (self.root / "docs/scenarios.md").unlink()
        result = self.export()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Missing Markdown source", result.stderr)
        self.assertFalse((self.root / "output/pdf/presentation.pdf").exists())

    def test_slide_overflow_rejects_and_preserves_previous_pdf(self):
        self.assertEqual(self.export().returncode, 0)
        target = self.root / "output/pdf/presentation.pdf"
        before = target.read_bytes()
        self.write("presentation", "# Слишком длинный слайд\n\n" + "Текст.\n\n" * 80)
        result = self.export()
        self.assertEqual(result.returncode, 1)
        self.assertIn("overflows", result.stderr)
        self.assertEqual(before, target.read_bytes())

    def test_unsupported_content_fails_instead_of_silently_dropping(self):
        self.write("scenarios", "# Проверка\n\n![График](missing.png)\n")
        result = self.export()
        self.assertEqual(result.returncode, 1)
        self.assertIn("Unsupported Markdown", result.stderr)
        self.assertFalse((self.root / "docs/presentation.pdf").exists())


if __name__ == "__main__":
    unittest.main()
