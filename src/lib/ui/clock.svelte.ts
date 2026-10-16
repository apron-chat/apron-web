import { createSubscriber } from 'svelte/reactivity';

/** One timer for every relative time on screen, ticking a minute at a time while anything reads it. */
const tick = createSubscriber((update) => {
	const timer = setInterval(update, 60_000);
	return () => clearInterval(timer);
});

/** The time now, read reactively: whatever reads it is redone each minute, so `5m` doesn't stay `5m`. */
export function minuteNow(): number {
	tick();
	return Date.now();
}
