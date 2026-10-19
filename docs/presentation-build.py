"""Compatibility entry point for the Markdown-driven PDF exporter."""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/export_pdf.py"), run_name="__main__")
