import { describe, expect, it } from 'vitest';
import { formatSnapshotDate } from './snapshotDate';

describe('formatSnapshotDate', () => {
	it('turns an ISO stamp into a Russian date', () => {
		expect(formatSnapshotDate('2026-10-19T12:30:48.822Z')).toBe('19.10.2026');
	});

	it('uses Astana time near midnight UTC', () => {
		expect(formatSnapshotDate('2026-10-19T20:00:00Z')).toBe('20.10.2026');
	});

	it('returns null for a stamp that is not a date', () => {
		expect(formatSnapshotDate('вчера')).toBeNull();
	});
});
