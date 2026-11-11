/**
 * What the full-screen viewers share (the image, terminal and document viewers): one at a time each, opened from what
 * it shows (`Viewer`), and a history entry of its own while open, so Back closes it (`backCloses`). Each has a host,
 * mounted once outside the timeline, that draws it. The page and the layout both load this from the start, so the
 * viewers' own chunks share it rather than splitting it out into one more file to load.
 */
import { untrack } from 'svelte';
import { pushState } from '$app/navigation';
import { page } from '$app/state';

/** The `page.state` keys a full-screen viewer marks its history entry with. */
export type ViewerEntry = 'media' | 'terminal' | 'doc';

/** A viewer of `V`: open on one at a time, and focus back on what opened it once it closes. */
export class Viewer<V> {
	open = $state(false);
	view = $state.raw<V>();
	#opener: HTMLElement | undefined;

	/** Opens on `view`; `opener` (what was clicked) gets focus back once it closes. */
	show(view: V, opener?: HTMLElement): void {
		this.view = view;
		this.#opener = opener;
		this.open = true;
	}

	/** What it shows went (its message did, or its room closed): it closes, if it shows that one. */
	forget(view: V): void {
		if (this.view === view) this.open = false;
	}

	/** It closed: focus goes back to what opened it, where it still is. */
	closed(): void {
		this.open = false;
		this.view = undefined;
		const opener = this.#opener;
		this.#opener = undefined;
		if (opener?.isConnected) opener.focus({ preventScroll: false });
	}
}

/**
 * A Back a viewer went, on its way: set when closing one goes Back off its entry, until that Back lands (popstate).
 * One for all the viewers: an entry pushed meanwhile, by any of them, is the one that Back would leave, closing it.
 */
let goingBack = $state(false);

function goBack(): void {
	goingBack = true;
	window.addEventListener('popstate', () => (goingBack = false), { once: true });
	history.back();
}

/**
 * A full-screen viewer as a history entry of its own, so Back closes it, as a phone's Back is expected to. Call it
 * while a component initializes: it sets up an effect. Once `isOpen` turns true, it pushes an entry marked under
 * `key` in `page.state` (with when it opened, each mark later than the last); leaving that entry, by Back or anything
 * else, calls `close`. It returns what to call once the viewer has closed, however it did: closed another way
 * (Escape, Close) while still on its entry, it goes Back off it, so Back later doesn't land on a viewer that's gone.
 * That Back lands a moment later: a viewer opened meanwhile, this one or another, waits for it before pushing its
 * own entry, which the Back would otherwise leave, closing it.
 */
export function backCloses(key: ViewerEntry, isOpen: () => boolean, close: () => void): () => void {
	/** The entry it pushed, while it is open on it; 0 for none. */
	let entry = 0;
	/** The last entry's mark: two opens in one millisecond (or under a stopped clock) differ. */
	let marked = 0;

	$effect(() => {
		const here = page.state[key];
		const open = isOpen();
		const waiting = goingBack;
		untrack(() => {
			if (entry) {
				if (here !== entry) {
					entry = 0;
					close();
				}
				return;
			}
			if (!open || waiting) return;
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
		if (entry && page.state[key] === entry) goBack();
		entry = 0;
	};
}
