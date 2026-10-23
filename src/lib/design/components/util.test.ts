import { describe, expect, it } from 'vitest';
import { chain, cssPx, fitRoles, rolePeek, roomName, roomNameTip, UNTITLED } from './util';

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

	it('calls a thread without a title Untitled, its room_id for a tooltip; a titled one, or a room, gets none', () => {
		expect(UNTITLED).toBe('Untitled');
		for (const title of [undefined, null, '', '  ']) {
			expect(roomName(title, 't1', { thread: true })).toBe('Untitled');
			expect(roomNameTip(title, 't1', { thread: true })).toBe('t1');
			expect(roomNameTip(title, 't1')).toBeUndefined();
		}
		expect(roomName('Deploy', 't1', { thread: true })).toBe('Deploy');
		expect(roomNameTip('Deploy', 't1', { thread: true })).toBeUndefined();
	});
});

describe('cssPx', () => {
	it('reads a plain length, and the math a computed min-width leaves unresolved', () => {
		expect(cssPx('0px', {})).toBe(0);
		expect(cssPx('12.5px', {})).toBe(12.5);
		expect(cssPx('min(96px, 100%)', { percent: 80 })).toBe(80);
		expect(cssPx('calc(100% - 8px)', { percent: 80 })).toBe(72);
		expect(cssPx('max(4em, 10px)', { em: 10 })).toBe(40);
		expect(cssPx('clamp(10px, 50%, 30px)', { percent: 100 })).toBe(30);
		expect(cssPx('calc(2 * 4px + 1px)', {})).toBe(9);
	});

	it('resolves calc-size() against the box’s natural size', () => {
		// As Chrome reports a name's least: all of a short name, --ap-name-min (6em) of a long one, the row where narrower.
		const least = 'calc-size(max-content, min(size, 96px, 100%))';
		expect(cssPx(least, { size: 40, percent: 300 })).toBe(40);
		expect(cssPx(least, { size: 200, percent: 300 })).toBe(96);
		expect(cssPx(least, { size: 200, percent: 60 })).toBe(60);
		expect(cssPx('calc-size(max-content, min(size, calc(20px + 8px + 96px), 100%))', { size: 300, percent: 400 })).toBe(124);
	});

	it('leaves what it can’t resolve to the caller', () => {
		expect(cssPx('auto', {})).toBeUndefined();
		expect(cssPx('min-content', {})).toBeUndefined();
		expect(cssPx('min(6em, 100%)', { percent: 50 })).toBeUndefined();
		expect(cssPx('calc-size(max-content, size)', {})).toBeUndefined();
		expect(cssPx('min(1px', {})).toBeUndefined();
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

describe('chain', () => {
	it('runs the caller\'s handler, then the component\'s own', () => {
		const calls: string[] = [];
		chain(() => calls.push('own'), () => calls.push('caller'))!(new Event('click', { cancelable: true }));
		expect(calls).toEqual(['caller', 'own']);
	});

	it('skips the component\'s own where the caller prevents the default', () => {
		const calls: string[] = [];
		chain(() => calls.push('own'), (event: Event) => { calls.push('caller'); event.preventDefault(); })!(new Event('click', { cancelable: true }));
		expect(calls).toEqual(['caller']);
	});

	it('passes either one through alone, and nothing for neither', () => {
		const own = () => {};
		expect(chain(own, undefined)).toBe(own);
		expect(chain(undefined, own)).toBe(own);
		expect(chain(undefined, null)).toBeUndefined();
	});
});
