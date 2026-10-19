import 'server-only';
import { type OpenStatus } from './places.schema';

interface Rule {
	days: number[];
	intervals: { end: number; start: number }[];
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MINUTES_PER_DAY = 1440;

function parseDays(raw: string | undefined): number[] | null {
	if (!raw) return [0, 1, 2, 3, 4, 5, 6];
	const days: number[] = [];
	for (const part of raw.split(',')) {
		const endpoints = part.split('-');
		if (endpoints.length > 2) return null;
		const [first, last = first] = endpoints;
		const start = DAYS.indexOf(first ?? '');
		const end = DAYS.indexOf(last ?? '');
		if (start < 0 || end < 0) return null;
		for (let offset = 0; offset < 7; offset++) {
			const day = (start + offset) % 7;
			days.push(day);
			if (day === end) break;
		}
	}
	return days;
}

function parseTime(raw: string): number | null {
	const match = /^(\d{2}):(\d{2})$/.exec(raw);
	if (!match) return null;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null;
	return hour * 60 + minute;
}

function parseRule(raw: string): Rule | null {
	const match = /^(?:([A-Za-z,-]+)\s+)?(.+)$/.exec(raw.trim());
	if (!match) return null;
	const days = parseDays(match[1]);
	if (!days) return null;
	const times = match[2]!;
	if (times === 'off' || times === 'closed') return { days, intervals: [] };
	if (times === '24/7') return { days, intervals: [{ end: MINUTES_PER_DAY, start: 0 }] };
	const intervals: Rule['intervals'] = [];
	for (const interval of times.split(',')) {
		const parts = interval.trim().split('-');
		if (parts.length !== 2) return null;
		const start = parseTime(parts[0]!);
		const end = parseTime(parts[1]!);
		if (start === null || end === null || start === MINUTES_PER_DAY || start === end) return null;
		intervals.push({ end: end < start ? end + MINUTES_PER_DAY : end, start });
	}
	return { days, intervals };
}

function clockText(minute: number): string {
	const withinDay = minute % MINUTES_PER_DAY;
	return `${String(Math.floor(withinDay / 60)).padStart(2, '0')}:${String(withinDay % 60).padStart(2, '0')}`;
}

export function openStatus(raw: string | null, at: Date): OpenStatus {
	const unknown: OpenStatus = {
		confidence: 'none',
		note: 'часы работы неизвестны — уточните перед выходом',
		opensAt: null,
		status: 'unknown',
		until: null,
	};
	if (!raw?.trim() || !Number.isFinite(at.getTime())) return unknown;
	const rules: Rule[] = [];
	let partial = false;
	for (const part of raw.split(';')) {
		let text = part.trim();
		const selector = /^([A-Za-z,-]+)\s+(.+)$/.exec(text);
		const tokens = selector?.[1]!.split(',') ?? [];
		if (selector && tokens.includes('PH')) {
			// Public holidays are not modelled: drop only the PH token and keep the weekdays it shares
			// a rule with ("Sa,Su,PH 08:00-23:00" still describes weekends). Confidence becomes low.
			partial = true;
			const days = tokens.filter((token) => token !== 'PH');
			text = days.length ? `${days.join(',')} ${selector[2]}` : '';
		}
		// A holiday-only rule ("PH off") leaves nothing to parse.
		if (!selector || text) {
			const rule = parseRule(text);
			// An unrecognised rule could override a recognised one. Never infer availability.
			if (!rule) return { ...unknown, confidence: 'low' };
			rules.push(rule);
		}
	}
	if (!rules.length) return { ...unknown, confidence: 'low' };
	// Read the supplied instant using the fixed Astana offset. No wall-clock reads.
	const timestampMinutes = Math.floor(at.getTime() / 60_000) + 300;
	const dayNumber = Math.floor(timestampMinutes / MINUTES_PER_DAY);
	const day = (((dayNumber + 4) % 7) + 7) % 7;
	const minute = ((timestampMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	const intervals: Rule['intervals'] = [];
	for (let offset = -1; offset <= 7; offset++) {
		const weekday = (day + offset + 7) % 7;
		// Later rules override the whole day, including explicit off exceptions.
		const ruleIndex = rules.findLastIndex((entry) => entry.days.includes(weekday));
		const rule = rules[ruleIndex];
		if (rule) {
			// A later normal rule for tomorrow also overrides carryover past midnight.
			// OSM: Sa 16:00-03:00; Su 16:00-23:00 is closed on Sunday at 01:00.
			const nextRuleIndex = rules.findLastIndex((entry) => entry.days.includes((weekday + 1) % 7));
			for (const interval of rule.intervals) {
				intervals.push({
					end:
						(nextRuleIndex > ruleIndex ? Math.min(interval.end, MINUTES_PER_DAY) : interval.end) +
						offset * MINUTES_PER_DAY,
					start: interval.start + offset * MINUTES_PER_DAY,
				});
			}
		}
	}
	intervals.sort((a, b) => a.start - b.start);
	const merged: Rule['intervals'] = [];
	for (const interval of intervals) {
		const previous = merged.at(-1);
		if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
		else merged.push({ ...interval });
	}
	const active = merged.find((interval) => interval.start <= minute && minute < interval.end);
	const next = merged.find((interval) => interval.start > minute);
	const confidence = partial ? 'low' : 'high';
	const caveat = partial ? '; праздничные дни не учтены — уточните перед выходом' : '';
	if (active) {
		const continuous = active.end - active.start >= 8 * MINUTES_PER_DAY;
		const until = continuous ? null : clockText(active.end);
		return {
			confidence,
			note: `по данным OSM открыто${until ? ` до ${until}` : ' круглосуточно'}${caveat}`,
			opensAt: null,
			status: 'open',
			until,
		};
	}
	return {
		confidence,
		note: `по данным OSM закрыто${next ? `; следующее открытие в ${clockText(next.start)}` : ''}${caveat}`,
		opensAt: next ? clockText(next.start) : null,
		status: 'closed',
		until: null,
	};
}
