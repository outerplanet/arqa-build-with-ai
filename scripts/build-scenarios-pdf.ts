/* eslint-disable no-console -- This CLI reports the output path and page count. */
/**
 * `pnpm scenarios:pdf` — docs/scenarios.md → printable HTML → docs/scenarios.pdf via local headless
 * Chrome. The converter covers only the Markdown that document uses: headings, paragraphs, lists,
 * tables, blockquotes, fenced code, rules, and inline code, bold and links.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'docs/scenarios.md';
const TARGET = 'docs/scenarios.pdf';

function escapeHtml(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Code spans are cut out first so `**` or `[` inside them stays literal. */
function inline(text: string): string {
	const codes: string[] = [];
	const withoutCode = text.replace(/`([^`]+)`/gu, (_, code: string) => {
		codes.push(`<code>${escapeHtml(code)}</code>`);
		return `${codes.length - 1}`;
	});
	// Private-use characters stand in for code spans and escaped asterisks while the rest is converted.
	return escapeHtml(withoutCode.replaceAll('\\*', ''))
		.replace(/\*\*(.+?)\*\*/gu, '<strong>$1</strong>')
		.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/gu, '<em>$1</em>')
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, '<a href="$2">$1</a>')
		.replaceAll('', '*')
		.replace(/(\d+)/gu, (_, index: string) => codes[Number(index)]!);
}

function cells(row: string): string[] {
	return row
		.trim()
		.replace(/^\||\|$/gu, '')
		.split('|')
		.map((cell) => cell.trim());
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/u;

export function markdownToHtml(markdown: string): string {
	const lines = markdown.replaceAll('\r\n', '\n').split('\n');
	const out: string[] = [];
	let index = 0;
	const isBlockStart = (line: string) =>
		/^(#{1,6}\s|```|>|\||---\s*$)/u.test(line) || LIST_ITEM.test(line) || line.trim() === '';
	while (index < lines.length) {
		const line = lines[index]!;
		if (line.trim() === '') {
			index += 1;
		} else if (line.startsWith('```')) {
			const body: string[] = [];
			index += 1;
			while (index < lines.length && !lines[index]!.startsWith('```')) {
				body.push(lines[index]!);
				index += 1;
			}
			index += 1;
			out.push(`<pre>${escapeHtml(body.join('\n'))}</pre>`);
		} else if (/^#{1,6}\s/u.test(line)) {
			const level = /^#+/u.exec(line)![0].length;
			out.push(`<h${level}>${inline(line.slice(level).trim())}</h${level}>`);
			index += 1;
		} else if (/^---\s*$/u.test(line)) {
			out.push('<hr>');
			index += 1;
		} else if (line.startsWith('|')) {
			const rows: string[][] = [];
			while (index < lines.length && lines[index]!.startsWith('|')) {
				rows.push(cells(lines[index]!));
				index += 1;
			}
			const [head, separator, ...body] = rows;
			const hasHeader = separator?.every((cell) => /^:?-+:?$/u.test(cell)) ?? false;
			const bodyRows = hasHeader ? body : rows.slice(1);
			const headHtml =
				hasHeader && head!.some(Boolean)
					? `<thead><tr>${head!.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
					: '';
			out.push(
				`<table${headHtml === '' ? ' class="plain"' : ''}>${headHtml}<tbody>${bodyRows
					.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
					.join('')}</tbody></table>`,
			);
		} else if (line.startsWith('>')) {
			const body: string[] = [];
			while (index < lines.length && lines[index]!.startsWith('>')) {
				body.push(lines[index]!.replace(/^>\s?/u, ''));
				index += 1;
			}
			out.push(`<blockquote>${markdownToHtml(body.join('\n'))}</blockquote>`);
		} else if (LIST_ITEM.test(line)) {
			const ordered = /^\s*\d+\./u.test(line);
			const items: string[] = [];
			while (index < lines.length) {
				const match = LIST_ITEM.exec(lines[index]!);
				if (match) {
					items.push(match[3]!);
				} else if (/^\s{2,}\S/u.test(lines[index]!) && items.length > 0) {
					items[items.length - 1] = `${items.at(-1) ?? ''} ${lines[index]!.trim()}`;
				} else {
					break;
				}
				index += 1;
			}
			const tag = ordered ? 'ol' : 'ul';
			out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
		} else {
			const body: string[] = [];
			while (index < lines.length && (body.length === 0 || !isBlockStart(lines[index]!))) {
				body.push(lines[index]!.trim());
				index += 1;
			}
			out.push(`<p>${inline(body.join(' '))}</p>`);
		}
	}
	return out.join('\n');
}

const STYLE = `
@page { size: A4; margin: 16mm 15mm 18mm; }
:root { --accent: #4F46E5; --ink: #1f2330; --muted: #5b6070; --line: #dfe1ea; --tint: #f4f4fd; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: var(--ink); font: 10.5pt/1.5 "Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif; hyphens: auto; }
main { max-width: 180mm; margin: 0 auto; }
h1 { margin: 0 0 4pt; color: var(--accent); font-size: 21pt; line-height: 1.2; }
h2 { margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid var(--accent); font-size: 14pt; break-after: avoid; }
h3 { margin: 12pt 0 4pt; font-size: 11.5pt; break-after: avoid; }
p { margin: 0 0 6pt; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 6pt; padding-left: 16pt; }
li { margin: 0 0 2.5pt; }
li::marker { color: var(--accent); }
strong { font-weight: 650; }
a { color: var(--accent); text-decoration: none; }
code { padding: 0 2pt; border-radius: 2pt; background: var(--tint); font: 9pt Consolas, "DejaVu Sans Mono", monospace; }
pre { margin: 4pt 0 8pt; padding: 7pt 9pt; border-left: 2.5pt solid var(--accent); border-radius: 0 3pt 3pt 0; background: var(--tint); white-space: pre-wrap; overflow-wrap: anywhere; font: 8.6pt/1.42 Consolas, "DejaVu Sans Mono", monospace; break-inside: avoid; }
table { width: 100%; margin: 4pt 0 10pt; border-collapse: collapse; font-size: 9.4pt; break-inside: auto; }
tr { break-inside: avoid; }
th { padding: 4pt 6pt; background: var(--accent); color: #fff; font-weight: 600; text-align: left; }
td { padding: 3.5pt 6pt; border-bottom: 0.6pt solid var(--line); vertical-align: top; }
tbody tr:nth-child(even) td { background: #fafafe; }
table.plain td:first-child { width: 28%; color: var(--muted); font-weight: 600; }
blockquote { margin: 6pt 0; padding: 4pt 10pt; border-left: 2.5pt solid var(--accent); color: var(--muted); }
hr { margin: 14pt 0; border: 0; border-top: 0.6pt solid var(--line); }
`;

function chromePath(): string {
	const candidates =
		process.platform === 'win32'
			? [
					String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
					String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
					join(process.env.LOCALAPPDATA ?? '', String.raw`Google\Chrome\Application\chrome.exe`),
				]
			: process.platform === 'darwin'
				? [
						'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
						'/Applications/Chromium.app/Contents/MacOS/Chromium',
					]
				: [
						'/usr/bin/google-chrome',
						'/usr/bin/google-chrome-stable',
						'/usr/bin/chromium',
						'/usr/bin/chromium-browser',
					];
	const found = [process.env.CHROME_PATH, ...candidates].find(
		(path) => path !== undefined && path !== '' && existsSync(path),
	);
	if (found === undefined) throw new Error('Chrome not found; set CHROME_PATH');
	return found;
}

async function main() {
	const markdown = await readFile(SOURCE, 'utf8');
	const title = /^#\s+(.+)$/mu.exec(markdown)?.[1] ?? 'Тестовые сценарии и ограничения';
	const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>
${markdownToHtml(markdown)}
</main></body></html>
`;
	const directory = await mkdtemp(join(tmpdir(), 'scenarios-pdf-'));
	try {
		const page = join(directory, 'scenarios.html');
		await writeFile(page, html, 'utf8');
		execFileSync(
			chromePath(),
			[
				'--headless=new',
				'--disable-gpu',
				'--no-first-run',
				'--no-pdf-header-footer',
				`--user-data-dir=${join(directory, 'profile')}`,
				`--print-to-pdf=${resolve(TARGET)}`,
				pathToFileURL(page).href,
			],
			{ stdio: 'ignore', timeout: 120000 },
		);
		// `--html=<path>` keeps the intermediate page, e.g. for a screenshot check outside the repository.
		const keep = process.argv.find((argument) => argument.startsWith('--html='))?.slice('--html='.length);
		if (keep) await writeFile(keep, html, 'utf8');
	} finally {
		await rm(directory, { force: true, recursive: true }).catch(() => undefined);
	}
	const pdf = await readFile(TARGET, 'latin1');
	const pages = pdf.match(/\/Type\s*\/Page(?!s)/gu)?.length ?? 0;
	console.log(`${TARGET}: ${pages} стр.`);
}

void main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : 'PDF не собран');
	process.exitCode = 1;
});
