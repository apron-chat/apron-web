import type { Identity } from '$lib/protocol/types';
import { clearView, loadView, saveView } from './session-cache';
import type { HeldSession } from './session.svelte';

/**
 * Keeps the session's view on this device for the next visit
 * (`session-cache.ts`), and brings it back: only for a session saved here (a
 * passkey or email account), the account it was kept for. A guest's next
 * visit is someone new, so a guest's view is never kept; a sign-out removes
 * it.
 */

/** What the keeper needs of the chat client. */
export interface KeeperClient {
	readonly url: string;
	/** A session is saved on this device for `url`: the next visit resumes it. */
	keptSessionFor(url: string): boolean;
}

/** The shortest gap between keeping the view; leaving the page keeps it at once. */
export const VIEW_SAVE_MS = 2000;

export class ViewKeeper {
	private savedAt = 0;
	private readonly enabled: boolean;
	private readonly databases: Pick<IDBFactory, 'open'> | undefined;
	private readonly now: () => number;

	/**
	 * `enabled`: false against the in-memory preview server, which keeps nothing. `indexedDB` is where views
	 * are kept, by default the browser's.
	 */
	constructor(options: { enabled?: boolean; indexedDB?: Pick<IDBFactory, 'open'>; now?: () => number } = {}) {
		this.enabled = options.enabled ?? true;
		this.databases = options.indexedDB;
		this.now = options.now ?? Date.now;
	}

	/** How long until the view may be kept again: a busy room keeps it at most once per `VIEW_SAVE_MS`. */
	wait(): number {
		return Math.max(0, this.savedAt + VIEW_SAVE_MS - this.now());
	}

	/** Keeps `view`, the session's held one (`SessionView.keepable`), for `you`, if the session is saved here. */
	keep(client: KeeperClient | undefined, view: HeldSession | undefined, you: Identity | undefined): Promise<void> {
		if (!this.enabled || !client || !view || !you || !client.keptSessionFor(client.url)) return Promise.resolve();
		this.savedAt = this.now();
		return saveView(client.url, you.user_id, view, this.databases);
	}

	/**
	 * The view kept for the client's server, while its session signs in and catches up: only for the session
	 * saved there. `show` takes it, unless the page has moved on meanwhile.
	 */
	async restore(client: KeeperClient, show: (view: HeldSession) => void): Promise<void> {
		if (!this.enabled || !client.keptSessionFor(client.url)) return;
		const kept = await loadView(client.url, this.databases);
		if (kept) show(kept.view);
	}

	/** Signed out of `server`: what was kept for it goes. */
	forget(server: string): Promise<void> {
		return clearView(server, this.databases);
	}
}
