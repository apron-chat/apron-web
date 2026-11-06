import { tickingClock } from '$lib/design/components/clock.svelte';

/** The time now, read reactively: whatever reads it is redone each minute, so `5m` doesn't stay `5m`. */
export const minuteNow = tickingClock(60_000);
