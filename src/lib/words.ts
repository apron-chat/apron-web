/* How text from a server reads in a sentence, and how a wait it asked for reads. Shared by the client's errors (protocol/client-internals.ts), the page (ui/time.ts) and the design system's notices (design/components/util.ts): all import it, none from another. */

/** A sentence as written, ending in `.` unless it ends in `.`, `!`, `?` or `…` already, such as a server's message. */
export function punctuated(text: string): string {
	const trimmed = text.trim();
	return !trimmed || /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** `45s`, `3m`, `2h`: a wait the server asked for (`retry_after`), as a refused request's error and a limited connection say it. */
export function retryAfterLabel(milliseconds: number): string {
	const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.ceil(minutes / 60)}h`;
}

/** A wait this long or longer in all counts down in minutes, with a clock rather than a ring, and can be put away. */
export const LONG_WAIT_MS = 60 * 60 * 1000;

/**
 * A wait's time left as a countdown shows it: `17s` under a minute, then `m:ss`; a `long` wait (LONG_WAIT_MS or
 * more in all) in whole minutes, `3h 12m`, rounded up so it never reads 0 before it is over.
 */
export function waitLabel(ms: number, long = false): string {
	if (long) {
		const minutes = Math.max(1, Math.ceil(ms / 60_000));
		const hours = Math.floor(minutes / 60);
		return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
	}
	const seconds = Math.max(0, Math.ceil(ms / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** `waitLabel` in words, for a screen reader: `17 seconds`, `3 hours 12 minutes`. */
export function waitWords(ms: number, long = false): string {
	const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
	if (!long && ms < 60_000) return unit(Math.max(1, Math.ceil(ms / 1000)), 'second');
	const minutes = Math.max(1, Math.ceil(ms / 60_000));
	const hours = Math.floor(minutes / 60);
	return hours ? [unit(hours, 'hour'), ...(minutes % 60 ? [unit(minutes % 60, 'minute')] : [])].join(' ') : unit(minutes, 'minute');
}
