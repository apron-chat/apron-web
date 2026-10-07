import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloatingDay } from './floating-day.svelte';
import { dayLabelOf } from './time';

const MAR_9 = String(new Date(2024, 2, 9, 16).getTime());
const MAR_10 = String(new Date(2024, 2, 10, 9).getTime());

/** Laid out top to bottom at `[top, bottom]` in the timeline, as it stands at scroll top 0. */
type Box = { top: number; bottom: number; id?: string };

/** A timeline scrolled down by `scrollTop`: day dividers and message rows, both in order. */
function timeline(scrollTop: number, dividers: Box[], rows: Box[]): HTMLElement {
	const element = ({ top, bottom, id }: Box) => ({
		dataset: { messageId: id },
		getBoundingClientRect: () => ({ top: top - scrollTop, bottom: bottom - scrollTop })
	});
	return {
		getBoundingClientRect: () => ({ top: 0 }),
		querySelectorAll: (selector: string) => (selector === '.ap-divider-date' ? dividers : rows).map(element)
	} as unknown as HTMLElement;
}

const dividers = [{ top: 24, bottom: 40 }, { top: 624, bottom: 640 }];
const rows = [
	{ top: 48, bottom: 300, id: MAR_9 },
	{ top: 300, bottom: 600, id: MAR_9 },
	{ top: 648, bottom: 900, id: MAR_10 }
];

describe('FloatingDay', () => {
	afterEach(() => vi.useRealTimers());

	it('floats the day of the first message still showing, then fades', () => {
		vi.useFakeTimers();
		const day = new FloatingDay();
		day.update(timeline(400, dividers, rows), false);
		expect(day.label).toBe(dayLabelOf(MAR_9));
		expect(day.shown).toBe(true);
		vi.runAllTimers();
		expect(day.shown).toBe(false);
	});

	it('floats nothing while that day\'s own divider still shows at the top', () => {
		const day = new FloatingDay();
		day.update(timeline(0, dividers, rows), false);
		expect(day.shown).toBe(false);
		day.update(timeline(620, dividers, rows), false);
		expect(day.shown).toBe(false);
		day.update(timeline(700, dividers, rows), false);
		expect(day.label).toBe(dayLabelOf(MAR_10));
		expect(day.shown).toBe(true);
		day.dispose();
	});

	it('floats nothing at the live end', () => {
		const day = new FloatingDay();
		day.update(timeline(400, dividers, rows), true);
		expect(day.shown).toBe(false);
	});
});
