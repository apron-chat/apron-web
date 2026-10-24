import { createSubscriber } from 'svelte/reactivity';

/** One timer for every countdown on screen, ticking a second at a time while anything reads it. */
const tick = createSubscriber((update) => {
	const timer = setInterval(update, 1000);
	return () => clearInterval(timer);
});

/** The time now, read reactively: whatever reads it is redone each second, so a countdown counts down. */
export function secondNow(): number {
	tick();
	return Date.now();
}
