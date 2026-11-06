import { historySettings } from '$lib/history/settings.svelte';
import { loadKeptSessionUser } from '$lib/protocol/client-internals';
import type { Identity } from '$lib/protocol/types';
import { clearView, clearViewOf, loadView, saveView } from './session-cache';
import type { HeldSession } from './session.svelte';

/**
 * Keeps the session's view on this device for the next visit
 * (`session-cache.ts`), and brings it back: only for a session saved here (a
 * passkey or email account), the account it was kept for. A guest's next
 * visit is someone new, so a guest's view is never kept; a sign-out removes
 * it. It is history kept on this device as much as `$lib/history`'s is, so
 * with Retention's Don't keep it is neither kept nor shown.
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
	/** What was kept is removed already, since keeping stopped: it goes once, not at every change. */
	private cleared = false;
	private readonly enabled: boolean;
	private readonly keeping: () => boolean;
	private readonly databases: Pick<IDBFactory, 'open'> | undefined;
	private readonly now: () => number;

	/**
	 * `enabled`: false against the in-memory preview server, which keeps nothing. `keeping`: whether history is
	 * kept on this device, by default as Retention says (`historySettings`). `indexedDB` is where views are kept,
	 * by default the browser's.
	 */
	constructor(options: { enabled?: boolean; keeping?: () => boolean; indexedDB?: Pick<IDBFactory, 'open'>; now?: () => number } = {}) {
		this.enabled = options.enabled ?? true;
		this.keeping = options.keeping ?? (() => historySettings.ms !== null);
		this.databases = options.indexedDB;
		this.now = options.now ?? Date.now;
	}

	/** How long until the view may be kept again: a busy room keeps it at most once per `VIEW_SAVE_MS`. */
	wait(): number {
		return Math.max(0, this.savedAt + VIEW_SAVE_MS - this.now());
	}

	/** Keeps `view`, the session's held one (`SessionView.keepable`), for `you`, if the session is saved here. */
	keep(client: KeeperClient | undefined, view: HeldSession | undefined, you: Identity | undefined): Promise<void> {
		if (!this.enabled) return Promise.resolve();
		if (!this.keeping()) return this.clear();
		if (!client || !view || !you || !client.keptSessionFor(client.url)) return Promise.resolve();
		this.cleared = false;
		this.savedAt = this.now();
		return saveView(client.url, you.user_id, view, this.databases);
	}

	/**
	 * The view kept for the client's server, while its session signs in and catches up: only for the session
	 * saved there, and only when it was kept for that session's account, where that is noted
	 * (`loadKeptSessionUser`). `show` takes it, unless the page has moved on meanwhile.
	 */
	async restore(client: KeeperClient, show: (view: HeldSession) => void): Promise<void> {
		if (!this.enabled) return;
		if (!this.keeping()) return this.clear();
		if (!client.keptSessionFor(client.url)) return;
		const kept = await loadView(client.url, this.databases);
		if (!kept) return;
		// Another account's (signed in there as someone else since): it goes, as a sign-in as them would drop it.
		const account = loadKeptSessionUser(client.url);
		if (account !== undefined && account !== kept.userId) return clearViewOf(client.url, kept.userId, this.databases);
		show(kept.view);
	}

	/** Keeping nothing: whatever was kept, for any server, goes, as Don't keep deletes every account's history. */
	private clear(): Promise<void> {
		if (this.cleared) return Promise.resolve();
		this.cleared = true;
		return clearView(undefined, this.databases);
	}

	/** Signed out of `server`: what was kept for it goes. */
	forget(server: string): Promise<void> {
		return clearView(server, this.databases);
	}
}
