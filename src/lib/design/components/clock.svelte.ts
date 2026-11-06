import { createSubscriber } from 'svelte/reactivity';

/**
 * A clock ticking every `ms` while anything reads it: one timer for all its readers, gone once none read it. It
 * returns the time now, read reactively, so whatever reads it is redone at each tick.
 */
export function tickingClock(ms: number): () => number {
	const tick = createSubscriber((update) => {
		const timer = setInterval(update, ms);
		return () => clearInterval(timer);
	});
	return () => {
		tick();
		return Date.now();
	};
}

/** The time now, read reactively: whatever reads it is redone each second, so a countdown counts down. */
export const secondNow = tickingClock(1000);
