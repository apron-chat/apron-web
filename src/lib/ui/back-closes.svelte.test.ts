// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, pushes } from '$lib/test/app-page.svelte';
import { backCloses } from './back-closes.svelte';

vi.mock('$app/state', async () => ({ page: (await import('$lib/test/app-page.svelte')).page }));
vi.mock('$app/navigation', async () => ({ pushState: (await import('$lib/test/app-page.svelte')).pushState }));

/** A viewer's open state, its history entry, and the Back its closing goes, which lands only when `land` says. */
function viewer() {
	const state = $state({ open: false });
	const close = vi.fn(() => (state.open = false));
	let leave!: () => void;
	const stop = $effect.root(() => {
		leave = backCloses('doc', () => state.open, close);
	});
	return { state, close, leave: () => leave(), stop };
}

/** History before the viewer's entry, which Back returns to. */
const before: App.PageState = { room: 'general' };
let backs = 0;

beforeEach(() => {
	page.state = before;
	pushes.length = 0;
	backs = 0;
	vi.spyOn(history, 'back').mockImplementation(() => void backs++);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** The Back `history.back()` asked for lands, as popstate does, a moment after. */
function land(): void {
	page.state = before;
	flushSync();
}

describe('backCloses', () => {
	it('pushes an entry as it opens, keeping the page\'s state, and Back closes it', () => {
		const v = viewer();
		v.state.open = true;
		flushSync();
		expect(pushes).toEqual([{ room: 'general', doc: expect.any(Number) }]);
		land();
		expect(v.close).toHaveBeenCalledOnce();
		// Closed by Back, it's already off its entry: closing goes nowhere.
		v.leave();
		expect(backs).toBe(0);
		v.stop();
	});

	it('closed another way, goes Back off its entry once, and the Back landing doesn\'t close it again', () => {
		const v = viewer();
		v.state.open = true;
		flushSync();
		v.state.open = false;
		v.leave();
		flushSync();
		expect(backs).toBe(1);
		land();
		expect([v.close.mock.calls.length, pushes.length]).toEqual([0, 1]);
		v.stop();
	});

	it('opened again before that Back lands, waits for it, so the Back doesn\'t close the new one', () => {
		vi.spyOn(Date, 'now').mockReturnValue(1000);
		const v = viewer();
		v.state.open = true;
		flushSync();
		v.state.open = false;
		v.leave();
		v.state.open = true;
		flushSync();
		// Still on the old entry, Back on its way: no new one yet.
		expect(pushes).toHaveLength(1);
		land();
		expect(v.close).not.toHaveBeenCalled();
		expect(pushes).toHaveLength(2);
		// Under a stopped clock, the new entry's mark still differs from the old.
		expect(pushes[1].doc).toBeGreaterThan(pushes[0].doc!);
		expect(page.state.doc).toBe(pushes[1].doc);
		land();
		expect(v.close).toHaveBeenCalledOnce();
		v.stop();
	});
});
