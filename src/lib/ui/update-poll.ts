/** How often an open tab looks for a newer deploy (SvelteKit's `version.pollInterval`, set in `vite.config.ts`). */
export const UPDATE_POLL_MS = 5 * 60 * 1000;

interface Visible {
	visibilityState: DocumentVisibilityState;
	addEventListener(type: 'visibilitychange', listener: () => void): void;
	removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Runs `check` when the page is shown again after `UPDATE_POLL_MS` or more hidden. The poll's timer doesn't run while
 * a phone holds the app frozen, nor (on many systems) while the device sleeps, so a copy back after hours could
 * otherwise wait out the rest of a poll before finding a newer deploy. Returns what stops it.
 */
export function checkOnReturn(check: () => void, doc: Visible = document, now: () => number = Date.now): () => void {
	let hiddenAt = doc.visibilityState === 'hidden' ? now() : undefined;
	const changed = () => {
		if (doc.visibilityState === 'hidden') {
			hiddenAt ??= now();
			return;
		}
		const away = hiddenAt === undefined ? 0 : now() - hiddenAt;
		hiddenAt = undefined;
		if (away >= UPDATE_POLL_MS) check();
	};
	doc.addEventListener('visibilitychange', changed);
	return () => doc.removeEventListener('visibilitychange', changed);
}
