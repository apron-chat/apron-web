import { describe, expect, it } from 'vitest';
import { chain, cssPx, fitRoles, rolePeek, times, waitLabel, waitWords } from './util';

describe('cssPx', () => {
	it('reads a plain length, and the math a computed min-width leaves unresolved, leaving what it can’t resolve to the caller', () => {
		expect(cssPx('0px', {})).toBe(0);
		expect(cssPx('12.5px', {})).toBe(12.5);
		expect(cssPx('min(96px, 100%)', { percent: 80 })).toBe(80);
		expect(cssPx('calc(100% - 8px)', { percent: 80 })).toBe(72);
		expect(cssPx('max(4em, 10px)', { em: 10 })).toBe(40);
		expect(cssPx('clamp(10px, 50%, 30px)', { percent: 100 })).toBe(30);
		expect(cssPx('calc(2 * 4px + 1px)', {})).toBe(9);
		// What it can't resolve is left to the caller.
		expect(cssPx('auto', {})).toBeUndefined();
		expect(cssPx('min-content', {})).toBeUndefined();
		expect(cssPx('min(6em, 100%)', { percent: 50 })).toBeUndefined();
		expect(cssPx('calc-size(max-content, size)', {})).toBeUndefined();
		expect(cssPx('min(1px', {})).toBeUndefined();
	});

	it('resolves calc-size() against the box’s natural size', () => {
		// As Chrome reports a name's least: all of a short name, --ap-name-min (6em) of a long one, the row where narrower.
		const least = 'calc-size(max-content, min(size, 96px, 100%))';
		expect(cssPx(least, { size: 40, percent: 300 })).toBe(40);
		expect(cssPx(least, { size: 200, percent: 300 })).toBe(96);
		expect(cssPx(least, { size: 200, percent: 60 })).toBe(60);
		expect(cssPx('calc-size(max-content, min(size, calc(20px + 8px + 96px), 100%))', { size: 300, percent: 400 })).toBe(124);
	});
});

describe('fitRoles', () => {
	// Three badges of 40, 70 and 50px with 4px between them: 40 · 114 · 168 to their ends.
	const widths = [40, 70, 50];

	it('shows every badge where the whole row fits', () => {
		expect(fitRoles(widths, 168, 4, 30)).toEqual({ shown: 3 });
		expect(fitRoles(widths, 500, 4, 30)).toEqual({ shown: 3 });
	});

	it('stacks what does not fit behind the last badge that does, leaving room for the stack, at most three roles deep', () => {
		// Two whole badges end at 114, plus one stacked role (4px): 118.
		expect(rolePeek(1)).toBe(4);
		expect(fitRoles(widths, 118, 4, 30)).toEqual({ shown: 2 });
		expect(fitRoles(widths, 117, 4, 30)).toEqual({ shown: 1 });
		// One badge (40) and two stacked behind it (8px).
		expect(rolePeek(2)).toBe(8);
		expect(fitRoles(widths, 48, 4, 30)).toEqual({ shown: 1 });
		// The stack is at most three roles deep, however many are behind.
		expect(rolePeek(3)).toBe(12);
		expect(rolePeek(9)).toBe(12);
		expect(rolePeek(0)).toBe(0);
	});

	it('narrows the first badge, down to its minimum, before showing none', () => {
		expect(fitRoles(widths, 47, 4, 30)).toEqual({ shown: 1, room: 39 });
		expect(fitRoles(widths, 38, 4, 30)).toEqual({ shown: 1, room: 30 });
		expect(fitRoles(widths, 37, 4, 30)).toEqual({ shown: 0 });
	});

	it('treats a single badge like a row of one: whole, narrowed or gone', () => {
		expect(fitRoles([60], 60, 4, 30)).toEqual({ shown: 1 });
		expect(fitRoles([60], 45, 4, 30)).toEqual({ shown: 1, room: 45 });
		expect(fitRoles([60], 29, 4, 30)).toEqual({ shown: 0 });
		expect(fitRoles([], 100, 4, 30)).toEqual({ shown: 0 });
	});
});

describe('chain', () => {
	it('runs the caller\'s handler, then the component\'s own, or either one alone', () => {
		const calls: string[] = [];
		chain(() => calls.push('own'), () => calls.push('caller'))!(new Event('click', { cancelable: true }));
		expect(calls).toEqual(['caller', 'own']);
		// Either one alone passes through, and neither gives nothing.
		const own = () => {};
		expect(chain(own, undefined)).toBe(own);
		expect(chain(undefined, own)).toBe(own);
		expect(chain(undefined, null)).toBeUndefined();
	});

	it('skips the component\'s own where the caller prevents the default', () => {
		const calls: string[] = [];
		chain(() => calls.push('own'), (event: Event) => { calls.push('caller'); event.preventDefault(); })!(new Event('click', { cancelable: true }));
		expect(calls).toEqual(['caller']);
	});
});

describe('waitLabel', () => {
	it('counts seconds under a minute, then m:ss; a long wait in minutes, rounded up', () => {
		expect([waitLabel(17_000), waitLabel(16_001), waitLabel(0), waitLabel(-5)]).toEqual(['17s', '17s', '0s', '0s']);
		expect([waitLabel(60_000), waitLabel(90_000), waitLabel(605_000)]).toEqual(['1:00', '1:30', '10:05']);
		expect([waitLabel((3 * 60 + 12) * 60_000, true), waitLabel(3_600_000, true), waitLabel(30_001, true)]).toEqual(['3h 12m', '1h 0m', '1m']);
		expect([waitWords(17_000), waitWords(1_000), waitWords(90_000), waitWords((3 * 60 + 12) * 60_000, true), waitWords(7_200_000, true)])
			.toEqual(['17 seconds', '1 second', '2 minutes', '3 hours 12 minutes', '2 hours']);
	});
});

describe('times', () => {
	it('gives every form of a time, and none past the last date a Date holds (formatting one throws), keeping a given time', () => {
		const at = times(Date.UTC(2026, 8, 14, 15, 4));
		expect(at.iso).toBe('2026-09-14T15:04:00.000Z');
		expect([at.short, at.compact, at.exact].every((value) => typeof value === 'string' && value !== '')).toBe(true);
		expect(times(8_640_000_000_000_000).iso).toBe('+275760-09-13T00:00:00.000Z');
		for (const timestamp of [8_640_000_000_000_001, 9_007_199_254_740_991, undefined, 0, -5, Number.NaN]) {
			expect(times(timestamp), String(timestamp)).toEqual({ short: undefined, compact: undefined });
		}
		expect(times(9_000_000_000_000_000, '2:02 PM')).toEqual({ short: '2:02 PM', compact: '2:02 PM' });
	});
});
