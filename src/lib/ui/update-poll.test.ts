import { describe, expect, it } from 'vitest';
import { checkOnReturn, UPDATE_POLL_MS } from './update-poll';

/** A document whose visibility the test sets, on a clock the test moves. */
function page() {
	const listeners = new Set<() => void>();
	const state = { now: 1_000_000, checks: 0 };
	const doc = {
		visibilityState: 'visible' as DocumentVisibilityState,
		addEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.add(fn),
		removeEventListener: (_: 'visibilitychange', fn: () => void) => void listeners.delete(fn)
	};
	const stop = checkOnReturn(() => (state.checks += 1), doc, () => state.now);
	const show = (visibility: DocumentVisibilityState) => {
		doc.visibilityState = visibility;
		for (const fn of listeners) fn();
	};
	/** Hidden for `ms`, then shown: a phone's frozen app, whose timers didn't run meanwhile. */
	const away = (ms: number) => {
		show('hidden');
		state.now += ms;
		show('visible');
	};
	return { state, away, show, stop };
}

describe('checking for a newer deploy on coming back', () => {
	it('checks at once when the page is shown after a poll’s worth of time hidden, not before', () => {
		const { state, away } = page();
		away(UPDATE_POLL_MS - 1);
		expect(state.checks).toBe(0);
		away(UPDATE_POLL_MS);
		expect(state.checks).toBe(1);
		away(8 * 60 * 60 * 1000);
		expect(state.checks).toBe(2);
	});

	it('counts from when the page was first hidden, and not a clock set back', () => {
		const { state, show, away } = page();
		show('hidden');
		state.now += UPDATE_POLL_MS / 2;
		// Hidden again (a second event while hidden) doesn't start the count over.
		show('hidden');
		state.now += UPDATE_POLL_MS / 2;
		show('visible');
		expect(state.checks).toBe(1);
		away(-24 * 60 * 60 * 1000);
		expect(state.checks).toBe(1);
	});

	it('stops when asked', () => {
		const { state, away, stop } = page();
		stop();
		away(UPDATE_POLL_MS);
		expect(state.checks).toBe(0);
	});
});
