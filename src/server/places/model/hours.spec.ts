import 'server-only';
import { describe, expect, it } from 'vitest';
import { openStatus } from './hours';

// 19 October 2026 is Monday. ISO instants have offsets so host timezone never matters.
const MONDAY_NOON = new Date('2026-10-19T12:00:00+05:00');

describe('OSM hours in Astana', () => {
	it('recognises continuous opening without inventing a closing time', () => {
		expect(openStatus('24/7', MONDAY_NOON)).toMatchObject({
			confidence: 'high',
			opensAt: null,
			status: 'open',
			until: null,
		});
	});
	it.each([null, '', '   '])('reports missing hours %s', (raw) => {
		expect(openStatus(raw, MONDAY_NOON)).toMatchObject({ confidence: 'none', status: 'unknown' });
	});
	it('uses UTC+5 independently of the host and treats closing as exclusive', () => {
		expect(openStatus('Mo-Fr 09:00-18:00', new Date('2026-10-19T04:00:00Z')).status).toBe('open');
		expect(openStatus('Mo-Fr 09:00-18:00', new Date('2026-10-19T13:00:00Z'))).toMatchObject({
			opensAt: '09:00',
			status: 'closed',
			until: null,
		});
	});
	it('supports day lists, split intervals and later off exceptions', () => {
		const raw = 'Mo,We,Fr 09:00-12:00,13:00-18:00; We off';
		expect(openStatus(raw, MONDAY_NOON)).toMatchObject({ opensAt: '13:00', status: 'closed' });
		expect(openStatus(raw, new Date('2026-10-21T10:00:00+05:00')).status).toBe('closed');
		expect(openStatus(raw, new Date('2026-10-23T10:00:00+05:00')).until).toBe('12:00');
	});
	it('carries overnight intervals into the next day and week', () => {
		expect(openStatus('Su 18:00-02:00', new Date('2026-10-19T01:00:00+05:00'))).toMatchObject({
			status: 'open',
			until: '02:00',
		});
		expect(openStatus('Su 18:00-02:00', new Date('2026-10-19T02:00:00+05:00')).status).toBe('closed');
	});
	it('supports wrapped day ranges and midnight closing', () => {
		expect(openStatus('Fr-Mo 09:00-24:00', MONDAY_NOON)).toMatchObject({ status: 'open', until: '00:00' });
	});
	it('lets later day rules replace overnight carryover', () => {
		expect(openStatus('Sa 16:00-03:00; Su 16:00-23:00', new Date('2026-10-25T01:00:00+05:00'))).toMatchObject({
			opensAt: '16:00',
			status: 'closed',
		});
		expect(openStatus('Mo 18:00-02:00; Tu off', new Date('2026-10-20T01:00:00+05:00')).status).toBe('closed');
		expect(openStatus('Mo 18:00-02:00; Tu off', new Date('2026-10-19T23:00:00+05:00')).until).toBe('00:00');
	});
	it('rejects malformed multi-part day ranges', () => {
		expect(openStatus('Mo-Tu-We 09:00-18:00', MONDAY_NOON)).toMatchObject({ confidence: 'low', status: 'unknown' });
	});
	it('merges adjacent intervals before announcing closing', () => {
		expect(openStatus('Mo 09:00-12:00,12:00-18:00', MONDAY_NOON).until).toBe('18:00');
	});
	it('ignores public holiday rules with explicit low confidence', () => {
		const result = openStatus('Mo-Fr 09:00-18:00; PH off', MONDAY_NOON);
		expect(result).toMatchObject({ confidence: 'low', status: 'open' });
		expect(result.note).toContain('праздничные дни не учтены');
		expect(openStatus('PH off', MONDAY_NOON).status).toBe('unknown');
	});
	it('keeps the weekday part of a rule that also lists public holidays, with low confidence', () => {
		const saturday = new Date('2026-10-24T12:00:00+05:00');
		const weekend = 'Mo-Fr 07:14-23:00; Sa,Su,PH 08:14-23:00';
		expect(openStatus(weekend, saturday)).toMatchObject({ confidence: 'low', status: 'open', until: '23:00' });
		expect(openStatus(weekend, new Date('2026-10-24T08:00:00+05:00'))).toMatchObject({
			confidence: 'low',
			opensAt: '08:14',
			status: 'closed',
		});
		expect(openStatus(weekend, MONDAY_NOON)).toMatchObject({ confidence: 'low', status: 'open' });
		const daily = openStatus('Mo-Su,PH 12:00-22:00', MONDAY_NOON);
		expect(daily).toMatchObject({ confidence: 'low', status: 'open', until: '22:00' });
		expect(daily.note).toContain('праздничные дни не учтены');
		expect(openStatus('PH,Mo 09:00-11:00', MONDAY_NOON)).toMatchObject({ confidence: 'low', status: 'closed' });
		expect(openStatus('PH 10:00-15:00', MONDAY_NOON)).toMatchObject({ confidence: 'low', status: 'unknown' });
		expect(openStatus('Mo-Fr 09:00-18:00 PH', MONDAY_NOON)).toMatchObject({ confidence: 'low', status: 'unknown' });
	});
	it.each([
		'sunrise-sunset',
		'Mo 09:00-25:00',
		'Mo 24:00-02:00',
		'Mo 09:00-09:00',
		'Mo 09:00-18:00; appointment',
		'Mo 09:00-18:00 "call first"',
		'Mo 09:60-18:00',
	])('never guesses for an unsupported or invalid expression: %s', (raw) => {
		expect(openStatus(raw, MONDAY_NOON)).toMatchObject({ confidence: 'low', status: 'unknown' });
	});
	it('handles permanently closed places and invalid instants', () => {
		expect(openStatus('off', MONDAY_NOON)).toMatchObject({ confidence: 'high', opensAt: null, status: 'closed' });
		expect(openStatus('24/7', new Date(Number.NaN)).status).toBe('unknown');
	});
});
