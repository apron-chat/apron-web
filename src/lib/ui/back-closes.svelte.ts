import { untrack } from 'svelte';
import { pushState } from '$app/navigation';
import { page } from '$app/state';

/** The `page.state` keys a full-screen viewer marks its history entry with. */
export type ViewerEntry = 'terminal' | 'doc';

/**
 * A full-screen viewer as a history entry of its own, so Back closes it, as a phone's Back is expected to. Call it
 * while a component initializes: it sets up an effect. Once `isOpen` turns true, it pushes an entry marked under
 * `key` in `page.state` (with when it opened, each mark later than the last); leaving that entry, by Back or anything
 * else, calls `close`. It returns what to call once the viewer has closed, however it did: closed another way
 * (Escape, Close) while still on its entry, it goes Back off it, so Back later doesn't land on a viewer that's gone.
 * That Back lands a moment later: a viewer opened again meanwhile waits for it before pushing its own entry, which
 * the Back would otherwise leave, closing it.
 */
export function backCloses(key: ViewerEntry, isOpen: () => boolean, close: () => void): () => void {
	/** The entry it pushed, while it is open on it; 0 for none. */
	let entry = 0;
	/** The entry it went Back from, until that Back lands; 0 for none. */
	let leaving = 0;
	/** The last entry's mark: two opens in one millisecond (or under a stopped clock) differ. */
	let marked = 0;

	$effect(() => {
		const here = page.state[key];
		const open = isOpen();
		untrack(() => {
			if (leaving) {
				if (here === leaving) return;
				leaving = 0;
			}
			if (entry) {
				if (here !== entry) {
					entry = 0;
					close();
				}
				return;
			}
			if (!open) return;
			const mark = (marked = Math.max(Date.now(), marked + 1));
			try {
				pushState('', { ...page.state, [key]: mark });
				entry = mark;
			} catch {
				// The router isn't started yet (in development): it just isn't an entry Back leaves.
			}
		});
	});

	return () => {
		if (entry && page.state[key] === entry) {
			leaving = entry;
			history.back();
		}
		entry = 0;
	};
}
