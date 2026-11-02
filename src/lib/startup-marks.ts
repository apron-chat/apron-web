/**
 * Startup milestones as User Timing marks (`apron:<name>`), each the first time it happens on this page: what
 * `npm run qa -- startup` reads to tell where a load's time went (waiting on the server, or work in the page), and
 * what a real user's browser can report. A mark costs next to nothing; one already made is not made again, so a
 * reconnect leaves the first load's marks as they were.
 */
export type StartupMark = 'app' | 'socket-open' | 'signed-in' | 'rooms' | 'first-messages';

const made = new Set<StartupMark>();

export function startupMark(name: StartupMark): void {
	if (made.has(name)) return;
	made.add(name);
	globalThis.performance?.mark?.(`apron:${name}`);
}

/**
 * Marks `first-messages` once `list` first holds a message (`.ap-msg`), then stops looking: an attachment for the
 * message list, which costs one observer until then and nothing after.
 */
export function markFirstMessages(list: HTMLElement): (() => void) | undefined {
	if (made.has('first-messages') || typeof MutationObserver === 'undefined') return;
	if (list.querySelector('.ap-msg')) return void startupMark('first-messages');
	const observer = new MutationObserver(() => {
		if (!list.querySelector('.ap-msg')) return;
		startupMark('first-messages');
		observer.disconnect();
	});
	observer.observe(list, { childList: true, subtree: true });
	return () => observer.disconnect();
}
