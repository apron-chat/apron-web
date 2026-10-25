/**
 * What links in messages name (Appendix A.4) that nothing here has loaded:
 * messages (`ChatClient.fetchMessage`) and rooms (`ChatClient.listMembers`),
 * fetched once each for their cards and kept apart from the client's store,
 * which would show a message in its room's timeline. A read follows arrivals,
 * so a row redraws when its card's message or room comes. A failed fetch is
 * asked again only after a while, so a redraw doesn't ask again for a room the
 * viewer can't read.
 */
import type { RoomListing } from '$lib/protocol/client';
import type { MessageRecord } from '$lib/protocol/types';

const CACHE_MAX = 200;
export const LINKED_RETRY_MS = 60_000;

export class Linked<T> {
	/** Bumped as each fetch settles: what a read follows. */
	private arrivals = $state(0);
	/** What was fetched, or when it was found missing or the fetch failed. */
	private readonly known = new Map<string, { value: T } | { missing: number }>();
	private readonly pending = new Set<string>();
	/** Counts clears, so a fetch for an earlier server or identity is dropped. */
	private generation = 0;

	constructor(private readonly now: () => number = Date.now) {}

	/** What was fetched for `key`, if it has come. */
	get(key: string): T | undefined {
		void this.arrivals;
		const entry = this.known.get(key);
		return entry && 'value' in entry ? entry.value : undefined;
	}

	/** Fetches it with `fetch` unless it came, is on its way, or failed a moment ago; `get` has it once it comes. */
	load(key: string, fetch: () => Promise<T | undefined>): void {
		const entry = this.known.get(key);
		if (this.pending.has(key) || (entry && ('value' in entry || this.now() - entry.missing < LINKED_RETRY_MS))) return;
		const generation = this.generation;
		this.pending.add(key);
		const settle = (value: T | undefined) => {
			if (generation !== this.generation) return;
			this.pending.delete(key);
			this.known.delete(key);
			if (this.known.size >= CACHE_MAX) this.known.delete(this.known.keys().next().value as string);
			this.known.set(key, value === undefined ? { missing: this.now() } : { value });
			this.arrivals++;
		};
		// Asked after this turn: a row asks while it renders, and a request changes the client's state.
		void Promise.resolve().then(fetch).then(settle, () => settle(undefined));
	}

	/** Forgets them all: another server or identity sees other messages and rooms. */
	clear(): void {
		this.generation++;
		this.known.clear();
		this.pending.clear();
		this.arrivals++;
	}
}

/** The page's linked messages, by `room_id` and `message_id`, for the server it is on. */
export const linkedMessages = new Linked<MessageRecord>();
/** The page's linked rooms and threads, by `room_id`, for the server it is on. */
export const linkedRooms = new Linked<RoomListing>();
