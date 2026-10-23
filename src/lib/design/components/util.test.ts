import { describe, expect, it } from 'vitest';
import { fitRoles, rolePeek, roomName } from './util';

describe('roomName', () => {
	it('names a room or thread by its title, else its room_id (§3.4)', () => {
		expect(roomName('Deploy checklist', 't1')).toBe('Deploy checklist');
		expect(roomName(undefined, 't1')).toBe('t1');
		expect(roomName(null, 't1')).toBe('t1');
	});

	it('never names one by a blank: an empty or all-space title counts as none', () => {
		expect(roomName('', 't1')).toBe('t1');
		expect(roomName('   ', 't1')).toBe('t1');
		expect(roomName('\n\t', 't1')).toBe('t1');
	});

	it('keeps a title as written, spaces and all', () => {
		expect(roomName('  Ops  ', 't1')).toBe('  Ops  ');
	});
});

describe('fitRoles', () => {
	// Three badges of 40, 70 and 50px with 4px between them: 40 · 114 · 168 to their ends.
	const widths = [40, 70, 50];

	it('shows every badge where the whole row fits', () => {
		expect(fitRoles(widths, 168, 4, 30)).toEqual({ shown: 3 });
		expect(fitRoles(widths, 500, 4, 30)).toEqual({ shown: 3 });
	});

	it('stacks what does not fit behind the last badge that does, leaving room for the stack', () => {
		// Two whole badges end at 114, plus one stacked role (4px): 118.
		expect(rolePeek(1)).toBe(4);
		expect(fitRoles(widths, 118, 4, 30)).toEqual({ shown: 2 });
		expect(fitRoles(widths, 117, 4, 30)).toEqual({ shown: 1 });
		// One badge (40) and two stacked behind it (8px).
		expect(rolePeek(2)).toBe(8);
		expect(fitRoles(widths, 48, 4, 30)).toEqual({ shown: 1 });
	});

	it('narrows the first badge, down to its minimum, before showing none', () => {
		expect(fitRoles(widths, 47, 4, 30)).toEqual({ shown: 1, room: 39 });
		expect(fitRoles(widths, 38, 4, 30)).toEqual({ shown: 1, room: 30 });
		expect(fitRoles(widths, 37, 4, 30)).toEqual({ shown: 0 });
	});

	it('draws at most three roles deep, however many are behind', () => {
		expect(rolePeek(3)).toBe(12);
		expect(rolePeek(9)).toBe(12);
		expect(rolePeek(0)).toBe(0);
	});

	it('treats a single badge like a row of one: whole, narrowed or gone', () => {
		expect(fitRoles([60], 60, 4, 30)).toEqual({ shown: 1 });
		expect(fitRoles([60], 45, 4, 30)).toEqual({ shown: 1, room: 45 });
		expect(fitRoles([60], 29, 4, 30)).toEqual({ shown: 0 });
		expect(fitRoles([], 100, 4, 30)).toEqual({ shown: 0 });
	});
});
