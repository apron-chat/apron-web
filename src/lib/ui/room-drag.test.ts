import { describe, expect, it } from 'vitest';
import { landing, type Slot } from './room-drag';

/** The others' middles, as rows 30px tall with 2px between them from 0, with the carried room's place `from`th among them. */
const rows = (from: number, ...ids: string[]): Slot[] => ids.map((id, index) => ({ id, middle: (index < from ? index : index + 1) * 32 + 15 }));

describe('landing', () => {
	// The carried room's place is the second of three (0–30, 32–62, 64–94): the others are a, above it, and c, below.
	const others = [{ id: 'a', middle: 15 }, { id: 'c', middle: 79 }];

	it('stays in its place while its copy is over it, or less than half a row off it', () => {
		expect(landing(others, 1, 32, 62)).toBe(1);
		expect(landing(others, 1, 16, 46)).toBe(1);
		expect(landing(others, 1, 48, 78)).toBe(1);
	});

	it('passes a room above once its top goes up past that room’s middle, and one below once its bottom goes down past it', () => {
		expect(landing(others, 1, 14, 44)).toBe(0);
		expect(landing(others, 1, 50, 80)).toBe(2);
	});

	it('goes as far as its copy is, past several rooms at once', () => {
		expect(landing(rows(4, 'a', 'b', 'c', 'd'), 4, 0, 30)).toBe(0);
		expect(landing(rows(0, 'a', 'b', 'c', 'd'), 0, 120, 150)).toBe(4);
		expect(landing(rows(0, 'a', 'b', 'c', 'd'), 0, 60, 90)).toBe(2);
	});

	it('doesn’t go back and forth between rooms of different heights', () => {
		// A short room (30px) carried below a tall one (60px) that it has just passed: the tall one is now first, 0–60.
		const tallFirst = [{ id: 'tall', middle: 30 }];
		const at = landing(tallFirst, 1, 33, 63);
		expect(at).toBe(1);
		// Where it was, the tall one second (32–92), the same copy had passed it too.
		expect(landing([{ id: 'tall', middle: 62 }], 0, 33, 63)).toBe(1);
	});

	it('is the only place in a list of one', () => {
		expect(landing([], 0, -500, -470)).toBe(0);
	});
});
