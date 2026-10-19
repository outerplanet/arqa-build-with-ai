import { describe, expect, it } from 'vitest';
import { cn } from './classes';

describe('cn', () => {
	it('lets a caller override a component default of the same group', () => {
		expect(cn('inline-flex h-9 px-4 whitespace-nowrap', 'h-auto whitespace-normal')).toBe(
			'inline-flex px-4 h-auto whitespace-normal',
		);
		expect(cn('text-xs rounded-sm', 'text-sm')).toBe('rounded-sm text-sm');
	});

	it('keeps classes of different variants and unknown groups apart', () => {
		expect(cn('h-9 sm:h-10', 'h-auto')).toBe('sm:h-10 h-auto');
		expect(cn('text-fg text-sm', 'text-accent-fg')).toBe('text-fg text-sm text-accent-fg');
		expect(cn('border border-border', 'border-accent')).toBe('border border-border border-accent');
	});

	it('accepts clsx inputs and drops duplicates', () => {
		expect(cn('flex', false, undefined, ['gap-2', { 'gap-4': true }], 'flex')).toBe('gap-4 flex');
	});
});
