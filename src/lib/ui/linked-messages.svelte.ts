/**
 * Messages that links in messages name (Appendix A.4) and nothing here has
 * loaded, fetched once each for their quotes (`ChatClient.fetchMessage`) and
 * kept apart from the client's store, which would show them in their rooms'
 * timelines. A read follows arrivals, so a row redraws when its quote's
 * message comes. A failed fetch is asked again only after a while, so a
 * redraw doesn't ask again for a room the viewer can't read.
 */
import type { MessageRecord } from '$lib/protocol/types';

const CACHE_MAX = 200;
export const LINKED_RETRY_MS = 60_000;

export type FetchMessage = (roomId: string, messageId: string) => Promise<MessageRecord | undefined>;

export class LinkedMessages {
	/** Bumped as each fetch settles: what a read follows. */
	private arrivals = $state(0);
	/** A fetched message, or when it was found missing or the fetch failed. */
	private readonly known = new Map<string, MessageRecord | { missing: number }>();
	private readonly pending = new Set<string>();
	/** Counts clears, so a fetch for an earlier server or identity is dropped. */
	private generation = 0;

	constructor(private readonly now: () => number = Date.now) {}

	/** The fetched message `messageId` in `roomId`, if it has come. */
	get(roomId: string, messageId: string): MessageRecord | undefined {
		void this.arrivals;
		const entry = this.known.get(keyOf(roomId, messageId));
		return entry && 'message_id' in entry ? entry : undefined;
	}

	/** Fetches it with `fetch` unless it came, is on its way, or failed a moment ago; `get` has it once it comes. */
	load(roomId: string, messageId: string, fetch: FetchMessage): void {
		const key = keyOf(roomId, messageId);
		const entry = this.known.get(key);
		if (this.pending.has(key) || (entry && ('message_id' in entry || this.now() - entry.missing < LINKED_RETRY_MS))) return;
		const generation = this.generation;
		this.pending.add(key);
		const settle = (message: MessageRecord | undefined) => {
			if (generation !== this.generation) return;
			this.pending.delete(key);
			this.known.delete(key);
			if (this.known.size >= CACHE_MAX) this.known.delete(this.known.keys().next().value as string);
			this.known.set(key, message ?? { missing: this.now() });
			this.arrivals++;
		};
		// Asked after this turn: a row asks while it renders, and a request changes the client's state.
		void Promise.resolve().then(() => fetch(roomId, messageId)).then(settle, () => settle(undefined));
	}

	/** Forgets them all: another server or identity sees other messages. */
	clear(): void {
		this.generation++;
		this.known.clear();
		this.pending.clear();
		this.arrivals++;
	}
}

function keyOf(roomId: string, messageId: string): string {
	return `${roomId} ${messageId}`;
}

/** The page's linked messages, for the server it is on. */
export const linkedMessages = new LinkedMessages();
