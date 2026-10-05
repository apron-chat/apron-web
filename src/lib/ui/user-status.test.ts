import { describe, expect, it } from 'vitest';
import { pausedUntilLabel } from './pause';
import { byStatus, ownStatus, ownStatusLabel } from './user-status';
import type { Presence } from '$lib/design/components/types';

describe('ownStatus', () => {
	it('is dnd at once while paused, else what `you` says (§4.11)', () => {
		expect(ownStatus('online', 1_700_000_000_000)).toBe('dnd');
		expect(ownStatus('idle', true)).toBe('dnd');
		expect(ownStatus('idle', undefined)).toBe('idle');
		expect(ownStatus('away', undefined)).toBe('offline');
		expect(ownStatus(undefined, undefined)).toBeUndefined();
		expect(ownStatus(3, undefined)).toBeUndefined();
	});
	it('shows no dnd while paused where the server sends no status', () => {
		expect(ownStatus(undefined, true)).toBeUndefined();
		expect(ownStatus(undefined, 1_700_000_000_000)).toBeUndefined();
	});
	it('takes an empty status as none (§3.3)', () => {
		expect(ownStatus('', undefined)).toBeUndefined();
		expect(ownStatus('', true)).toBeUndefined();
	});
});

describe('ownStatusLabel', () => {
	const now = new Date(2026, 9, 2, 13, 30);
	it('says when a pause ends', () => {
		const until = new Date(2026, 9, 2, 14, 30).getTime();
		// "until 14:30", in the viewer's own clock.
		expect(ownStatusLabel('dnd', until, now)).toBe(`Do not disturb · ${pausedUntilLabel(until, now)}`);
		expect(pausedUntilLabel(until, now)).toMatch(/^until \d/);
		expect(ownStatusLabel('dnd', true, now)).toBe('Do not disturb · until you resume');
	});
	it('is the status in words otherwise', () => {
		expect(ownStatusLabel('dnd', undefined, now)).toBe('Do not disturb');
		expect(ownStatusLabel('online', undefined, now)).toBe('Online');
		expect(ownStatusLabel(undefined, undefined, now)).toBeUndefined();
	});
});

describe('byStatus', () => {
	it('orders online, idle, dnd, offline, then no status, keeping the order within each', () => {
		const people: Array<[string, Presence | undefined]> = [
			['ann', undefined], ['bo', 'offline'], ['cy', 'idle'], ['di', 'online'], ['ed', 'dnd'], ['fy', 'online'], ['gu', 'offline'], ['ha', 'idle']
		];
		const statuses = new Map(people);
		expect(byStatus(people.map(([id]) => id), (id) => statuses.get(id))).toEqual(['di', 'fy', 'cy', 'ha', 'ed', 'bo', 'gu', 'ann']);
	});
	it('leaves the input alone', () => {
		const ids = ['b', 'a'];
		byStatus(ids, (id) => (id === 'a' ? 'online' : undefined));
		expect(ids).toEqual(['b', 'a']);
	});
});
