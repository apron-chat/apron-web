import { describe, expect, it, vi } from 'vitest';
import { PushTitles, roomTitlesOf, TITLES_MAX, type TitledRoom } from './push-titles';

const room = (id: string, title: string, joined = true, namedForMembers?: true): TitledRoom => ({ id, title, joined, ...(namedForMembers ? { namedForMembers } : {}) });

describe('the room titles kept for pushes', () => {
	it('names each room as a notification does, joined rooms first, at most TITLES_MAX', () => {
		const titles = roomTitlesOf([room('viewed', 'Read only', false), room('general', 'General'), room('p1', 'Bob', true, true), room('blank', '')]);
		expect([...titles]).toEqual([['general', { title: 'General' }], ['p1', { title: 'Bob', namedForMembers: true }], ['viewed', { title: 'Read only' }]]);
		const many = Array.from({ length: TITLES_MAX + 10 }, (_, index) => room(`r${index}`, `Room ${index}`, index >= 10));
		const kept = roomTitlesOf(many);
		expect(kept.size).toBe(TITLES_MAX);
		// The joined ones win the room left; the ten not joined are left out.
		expect(kept.has('r0')).toBe(false);
		expect(kept.has('r10')).toBe(true);
	});

	it('writes only when the titles change, and forgets an account once push is off for it or another signs in', async () => {
		const save = vi.fn(async () => undefined);
		const titles = new PushTitles(save);
		const rooms = [room('general', 'General')];
		await titles.keep('a1', rooms);
		await titles.keep('a1', [room('general', 'General')]);
		expect(save).toHaveBeenCalledTimes(1);
		await titles.keep('a1', [room('general', 'Town square')]);
		expect(save).toHaveBeenLastCalledWith('a1', new Map([['general', { title: 'Town square' }]]));
		await titles.keep('b2', rooms);
		expect(save.mock.calls.slice(-2)).toEqual([['a1', undefined], ['b2', new Map([['general', { title: 'General' }]])]]);
		await titles.keep(undefined, undefined);
		expect(save).toHaveBeenLastCalledWith('b2', undefined);
		const count = save.mock.calls.length;
		await titles.keep(undefined, undefined);
		expect(save).toHaveBeenCalledTimes(count);
	});
});
