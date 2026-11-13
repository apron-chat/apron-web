import { draftKeys, loadDraft, removeDraft, saveDraft, type SavedDraft } from './storage';
import { notifyAccount } from './notify-scopes';
import type { DraftStore } from './pane-drafts.svelte';

/**
 * How often a draft being typed is written down, at most: the first change after a write starts the wait, and
 * typing on doesn't put it off, so a crash loses no more than this. Hiding or leaving the page writes at once.
 */
const SAVE_EVERY_MS = 1_000;

/** The server a draft key names: the page's `draftKey`, `[server, room_id]` as JSON. */
export function draftServer(key: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(key);
		return Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string' ? parsed[0] : undefined;
	} catch {
		return undefined;
	}
}

/** The draft as kept: without what says nothing (an empty reply or list), and none at all without text or a reply. */
function keepable(draft: SavedDraft): SavedDraft | undefined {
	if (!draft.text.trim() && !draft.reply) return undefined;
	return { text: draft.text, ...(draft.reply ? { reply: draft.reply } : {}), ...(draft.dismissed?.length ? { dismissed: draft.dismissed } : {}) };
}

/** What `written` notes of a draft: whose and what, or empty for none. */
function noted(draft: SavedDraft | undefined, owner: string): string {
	return draft ? `${owner}\n${JSON.stringify(draft)}` : '';
}

/**
 * Each draft as this page last wrote or read it, by key (`noted`): one is written again only once it says something
 * else, or is someone else's, so moving between panes, or a write that changed nothing, writes nothing.
 */
const written = new Map<string, string>();

/**
 * Forgets the drafts kept for `server` (every server's, without), only `owner`'s (`notifyAccount`), if given: with
 * that account's history (`HistoryKeeper.forget`).
 */
export function forgetDrafts(server?: string, owner?: string): void {
	for (const key of draftKeys()) {
		if (server !== undefined && draftServer(key) !== server) continue;
		if (owner !== undefined && loadDraft(key)?.owner !== owner) continue;
		removeDraft(key);
		written.delete(key);
	}
}

/**
 * How the drafts a page holds for a server fare as its account is known (`DraftKeeper.claim`): `same`, still theirs;
 * `carried`, a guest's that become the account's it signed in as; `dropped`, another account's, which the page forgets.
 */
export type DraftClaim = 'same' | 'carried' | 'dropped';

/**
 * Keeps each room's and thread's unsent draft on this device (`PaneDrafts`), so that a reload, a closed tab or a
 * crash doesn't take it: its text, the message it replies to and the link previews removed from it; staged files
 * only last the visit. Each in its own storage item, so writing one costs that one however many are kept.
 *
 * Each is kept as the account's it was written by, and only ever read back for that account. Whose a server's drafts
 * are is asked of `ownerOf` (the account signed in, or, until a session is, the one saved on this device for the
 * server, else its guests) the first time it matters this visit, and from then on changes only as a session there is
 * ready as someone (`claim`): a saved session that goes or changes underneath (a token that
 * expired, another tab signing in) doesn't hand what the page holds to someone else. A draft whose account isn't
 * known yet waits to be read or written until it is. An account signing in forgets what others left on its server,
 * and an account's go with its history (`HistoryKeeper.forget`: signing out without keeping it, or Clear).
 *
 * A change only marks its draft changed (`changed`): what is written is the draft as it is when the write comes, at
 * most every SAVE_EVERY_MS while it changes, and at once as the page is hidden or left (`flush`). Nothing is written
 * while `keeps` says no (local history turned off).
 */
export class DraftKeeper implements DraftStore {
	readonly #keeps: () => boolean;
	readonly #ownerOf: (server: string) => string | undefined;
	/** The drafts changed and not written yet, by key, and where to read each as it now is. */
	readonly #dirty = new Map<string, (key: string) => SavedDraft>();
	/** Whose the drafts this page holds for each server are, once first asked: changed only by `claim`. */
	readonly #used = new Map<string, string>();
	/** Who `claim` last said is signed in to each server. */
	readonly #claimed = new Map<string, string>();
	/**
	 * Some draft isn't written and a reload would lose it: storage refused it, or whose it is wasn't known at the last
	 * write. Read by what says a reload loses a draft (`keeps`), so state.
	 */
	#atRisk = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** The page's drafts (`attach`), all written again as keeping resumes. */
	#all: { keys: () => Iterable<string>; read: (key: string) => SavedDraft } | undefined;
	/** Whether drafts were kept at the last write: turned back on since, every one is written again. */
	#kept: boolean;

	constructor(keeps: () => boolean, ownerOf: (server: string) => string | undefined) {
		this.#keeps = keeps;
		this.#ownerOf = ownerOf;
		this.#kept = keeps();
	}

	attach(keys: () => Iterable<string>, read: (key: string) => SavedDraft): void {
		this.#all = { keys, read };
	}

	keeps(): boolean {
		return !this.#atRisk && this.#keeps();
	}

	knows(key: string): boolean {
		const server = draftServer(key);
		return server !== undefined && this.#owner(server) !== undefined;
	}

	load(key: string): SavedDraft | undefined {
		const server = draftServer(key);
		const owner = server === undefined ? undefined : this.#owner(server);
		if (owner === undefined || !this.#keeps()) return undefined;
		const kept = loadDraft(key);
		const draft = kept?.owner === owner ? kept.draft : undefined;
		written.set(key, noted(draft, owner));
		return draft;
	}

	changed(key: string, read: (key: string) => SavedDraft): void {
		this.#dirty.set(key, read);
		this.#timer ??= setTimeout(() => this.flush(), SAVE_EVERY_MS);
	}

	/**
	 * Writes the drafts changed since the last write, as they now are: as the page is hidden or left, or once the wait
	 * is up. One whose account isn't known yet stays to be written once it is.
	 */
	flush(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		const keeping = this.#keeps();
		// Kept again (local history turned back on): what was written before went with it, so all of it is written.
		if (keeping && !this.#kept && this.#all) for (const key of this.#all.keys()) this.#dirty.set(key, this.#all.read);
		this.#kept = keeping;
		if (!keeping) {
			this.#dirty.clear();
			return this.#setAtRisk(false);
		}
		for (const [key, read] of [...this.#dirty]) {
			const server = draftServer(key);
			const owner = server === undefined ? undefined : this.#owner(server);
			if (owner === undefined) continue;
			this.#dirty.delete(key);
			const draft = keepable(read(key));
			const note = noted(draft, owner);
			if (written.get(key) === note) continue;
			// Emptied: what is kept goes, unless it is someone else's (the page dropped theirs, and has none of its own).
			if (!draft) {
				if (loadDraft(key)?.owner === owner) removeDraft(key);
				written.set(key, note);
				continue;
			}
			const evicted = saveDraft(key, draft, owner);
			if (!evicted) {
				// Tried again with the next write; until then, a reload would lose it.
				this.#dirty.set(key, read);
				continue;
			}
			for (const each of evicted) written.delete(each);
			written.set(key, note);
		}
		this.#setAtRisk(this.#dirty.size > 0);
	}

	/**
	 * `owner` (`notifyAccount`) is signed in to `server`, as its session says now it is ready. An account forgets what
	 * others left there (a guest leaves it, for the account it may sign in as). Says how the drafts the page holds there
	 * fare: still `owner`'s, `carried` from a guest's to `owner`'s, or `dropped` as another account's.
	 */
	claim(server: string, owner: string): DraftClaim {
		// Whose they were taken to be: asked now if nothing has been read or written there yet.
		const used = this.#owner(server);
		this.#used.set(server, owner);
		const guest = (account: string) => account === notifyAccount(server, undefined);
		const claim: DraftClaim = used === undefined || used === owner ? 'same' : guest(used) ? 'carried' : 'dropped';
		if (claim === 'dropped') this.#drop(server);
		if (this.#claimed.get(server) !== owner) {
			this.#claimed.set(server, owner);
			if (!guest(owner) && this.#keeps()) {
				for (const key of draftKeys()) {
					if (draftServer(key) !== server || loadDraft(key)?.owner === owner) continue;
					removeDraft(key);
					written.delete(key);
				}
			}
		}
		// What waited for its account to be known goes in the next write.
		if (this.#dirty.size) this.#timer ??= setTimeout(() => this.flush(), SAVE_EVERY_MS);
		return claim;
	}

	/** Whose `server`'s drafts are: as first asked of `ownerOf` this visit, and then as `claim` says. Undefined: not known yet. */
	#owner(server: string): string | undefined {
		const used = this.#used.get(server);
		if (used !== undefined) return used;
		const owner = this.#ownerOf(server);
		if (owner !== undefined) this.#used.set(server, owner);
		return owner;
	}

	#setAtRisk(atRisk: boolean): void {
		if (this.#atRisk !== atRisk) this.#atRisk = atRisk;
	}

	#drop(server: string): void {
		for (const key of [...this.#dirty.keys()]) {
			if (draftServer(key) === server) this.#dirty.delete(key);
		}
		this.#setAtRisk(this.#dirty.size > 0);
	}
}
