"""Append unedited local QA tool logs and replies to the scenario document.

The JSON evidence is the only source of transcript text. Existing narrative is
retained; reruns replace the generated appendix rather than duplicating it.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKER = "<!-- GENERATED QA TRANSCRIPT -->"


def main():
    evidence = json.loads((ROOT / "docs/qa-search-matrix.json").read_text(encoding="utf-8"))
    records = [record for record in evidence["records"] if record["backend"] == "local"]
    if not records or not all(record["passed"] for record in evidence["records"]):
        raise ValueError("QA report is empty or contains failed cases; inspect JSON evidence")
    blocks = [MARKER, "## Полные фактические ответы и логи локального прогона",
              "Этот раздел воспроизводится командой `python3 scripts/qa_report.py` из "
              "`docs/qa-search-matrix.json`. Входы тестовые; ответы и результаты инструментов "
              "вставлены без ручного пересказа. Логи лексического режима и отказа Python "
              "сохранены в том же JSON. Время сценария фиксировано, время выполнения указано отдельно."]
    for record in records:
        blocks.extend([f"### {record['id']}", "Вход:",
                       "```json\n" + json.dumps(record["input"], ensure_ascii=False, indent=2) + "\n```",
                       "Вызовы инструментов (полные аргументы и результаты):"])
        for call in record["result"]["toolCalls"]:
            blocks.append("```json\n" + json.dumps(call, ensure_ascii=False, indent=2) + "\n```")
        if not record["result"]["toolCalls"]:
            blocks.append("Вызовов нет.")
        blocks.extend(["Итоговый ответ ассистента (дословно):",
                       "```text\n" + record["result"]["reply"] + "\n```"])
    target = ROOT / "docs/scenarios.md"
    narrative = target.read_text(encoding="utf-8").split(MARKER)[0].rstrip()
    target.write_text(narrative + "\n\n" + "\n\n".join(blocks) + "\n", encoding="utf-8")
    print(f"Added {len(records)} actual local transcripts")


if __name__ == "__main__":
    main()
