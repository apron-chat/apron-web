// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, pushes } from '$lib/test/app-page.svelte';
import { backCloses } from './viewer.svelte';

vi.mock('$app/state', async () => ({ page: (await import('$lib/test/app-page.svelte')).page }));
vi.mock('$app/navigation', async () => ({ pushState: (await import('$lib/test/app-page.svelte')).pushState }));

/** A viewer's open state, its history entry, and the Back its closing goes, which lands only when `land` says. */
function viewer(key: 'doc' | 'media' = 'doc') {
	const state = $state({ open: false });
	const close = vi.fn(() => (state.open = false));
	let leave!: () => void;
	const stop = $effect.root(() => {
		leave = backCloses(key, () => state.open, close);
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

/** The Back `history.back()` asked for lands, a moment after: the page's state goes back to the entry before. */
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

	it('waits while the page is still on the entry the Back left, and no longer once anything has moved it off', () => {
		const doc = viewer('doc');
		const media = viewer('media');
		doc.state.open = true;
		flushSync();
		doc.state.open = false;
		doc.leave();
		media.state.open = true;
		flushSync();
		// Something else changed the page's state, but it is still on the doc's entry: the Back hasn't landed.
		page.state = { ...page.state, thread: 'deploy' };
		flushSync();
		expect(pushes).toHaveLength(1);
		// Moved off it some other way than that Back (a navigation that replaced it): the media viewer's entry goes in.
		page.state = { room: 'ops' };
		flushSync();
		expect(pushes[1]).toEqual({ room: 'ops', media: expect.any(Number) });
		expect(media.close).not.toHaveBeenCalled();
		doc.stop();
		media.stop();
	});

	it('another viewer opened before that Back lands waits for it too, so the Back doesn\'t close it', () => {
		const doc = viewer('doc');
		const media = viewer('media');
		doc.state.open = true;
		flushSync();
		doc.state.open = false;
		doc.leave();
		media.state.open = true;
		flushSync();
		expect(pushes.map((state) => Object.keys(state).filter((key) => key !== 'room'))).toEqual([['doc']]);
		land();
		expect(media.close).not.toHaveBeenCalled();
		expect(pushes[1]).toEqual({ room: 'general', media: expect.any(Number) });
		doc.stop();
		media.stop();
	});
});
