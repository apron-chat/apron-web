/**
 * Search Local History's messages (`SearchDialog`): as the query is typed, after a pause, what this server's history
 * keeps on this device (`HistoryKeeper.searchKept`) and what the page holds that matches it (`$lib/ui/search`), the
 * newest first; and Load More from Server, which pages older history into the rooms searched and searches again.
 */
import type { SearchFoot } from '$lib/design/components/types';
import type { HistoryKeeper } from '$lib/history/history-keeper';
import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
import { compareLogIds } from '$lib/protocol/reducer';
import type { MessageRecord } from '$lib/protocol/types';
import { folded, newestMatches, queryMatcher, type SearchQuery } from './search';

/** How long typing pauses before a search starts. */
export const SEARCH_DELAY_MS = 150;
/** The most rooms one Load More from Server pages back in, the most recently active first. */
export const LOAD_ROOMS = 10;

/** What a message search reads, as it changes. */
export interface MessageSearchHost {
	readonly client: Pick<ChatClient, 'url' | 'snapshot' | 'roomRecord' | 'storedRecords' | 'loadOlder' | 'loadRoom'>;
	/** What keeps history on this device, while it keeps this session's. */
	readonly keeper?: Pick<HistoryKeeper, 'searchKept'>;
	/** The rooms shown: joined, or open without joining. */
	readonly rooms: readonly RoomSnapshot[];
	/** What is typed, read (`parseQuery`). */
	readonly query: SearchQuery;
	/** Messages are what is searched now: otherwise it finds nothing, and asks nothing. */
	readonly active: boolean;
}

const asks = (query: SearchQuery) => Boolean(query.text || query.users.length || query.rooms.length);

export class MessageSearch {
	private readonly host: MessageSearchHost;
	/** What matched, newest first, at most `SEARCH_LIMIT`; `more` when others did too. */
	found = $state.raw<MessageRecord[]>([]);
	more = $state(false);
	/** A search is under way for what's typed. */
	searching = $state(false);
	/** Load More from Server is under way, and why it failed, when every page it asked for did. */
	loading = $state(false);
	loadError = $state('');
	/** Bumped once older pages have loaded: the same query searches again, now with them. */
	private loads = $state(0);
	/** Counts searches: one that a newer one replaced stops, and its results go unshown. */
	private generation = 0;

	/** The rooms searched, shown here: those `room:` names, with their threads, else every one you've joined. */
	readonly searched: RoomSnapshot[];
	/** Of those, the ones the server has older history for: never loaded (a thread loads when opened), or with older pages. */
	readonly older: RoomSnapshot[];
	/** After the results: what Load More from Server would load, or that everything is. */
	readonly foot: SearchFoot | undefined;

	/** Made as the dialog's component starts: it searches, after a pause, each time what's typed changes. */
	constructor(host: MessageSearchHost) {
		this.host = host;
		this.searched = $derived.by(() => {
			if (!host.active) return [];
			const named = host.query.rooms;
			if (!named.length) return host.rooms.filter((room) => room.joined);
			const ids = new Set(host.rooms.filter((room) => named.some((value) => folded(room.id) === value || folded(room.title) === value)).map((room) => room.id));
			return host.rooms.filter((room) => ids.has(room.id) || (room.parentRoomId !== undefined && ids.has(room.parentRoomId)));
		});
		this.older = $derived(this.searched.filter((room) => !room.recoveryError && !room.loading && !room.loadingOlder && (!room.loaded || room.olderAvailable)));
		this.foot = $derived.by(() => {
			if (!host.active || !asks(host.query) || !this.searched.length) return undefined;
			const where = host.query.rooms.length ? (this.searched.find((room) => room.parentRoomId === undefined) ?? this.searched[0]).title : 'your rooms';
			if (!this.older.length && !this.loading) return { note: this.loadError || `Everything the server has in ${where} is loaded, and searched.` };
			return { note: this.loadError || `Older messages in ${where} are on the server.`, label: 'Load More from Server', busy: this.loading, onclick: () => void this.loadMore() };
		});
		$effect(() => {
			const asked = host.query;
			const active = host.active;
			void this.loads;
			const run = ++this.generation;
			if (!active || !asks(asked)) {
				this.found = [];
				this.more = false;
				this.searching = false;
				return;
			}
			this.searching = true;
			const timer = setTimeout(() => void this.search(asked, run), SEARCH_DELAY_MS);
			return () => clearTimeout(timer);
		});
	}

	private async search(asked: SearchQuery, run: number): Promise<void> {
		const { client, keeper } = this.host;
		const test = queryMatcher(asked, { users: Object.values(client.snapshot().users), rooms: this.host.rooms, parentOf: (roomId) => client.roomRecord(roomId)?.parent_room_id });
		if (!test) return;
		const loaded = client.storedRecords().messages.filter(test);
		// Only the signed-in account's: each account's kept history is a database of its own.
		const you = client.snapshot().you?.user_id;
		const kept = keeper && you !== undefined ? await keeper.searchKept(client.url, you, test, () => run !== this.generation) : [];
		if (run !== this.generation) return;
		({ messages: this.found, more: this.more } = newestMatches([kept, loaded]));
		this.searching = false;
	}

	/** A page further back in each of the LOAD_ROOMS most recently active rooms with more, and the search again. */
	async loadMore(): Promise<void> {
		if (this.loading) return;
		const next = this.older.toSorted(byActivity).slice(0, LOAD_ROOMS);
		this.loading = true;
		this.loadError = '';
		const { client } = this.host;
		const pages = await Promise.allSettled(next.map((room) => (room.loaded ? client.loadOlder(room.id) : client.loadRoom(room.id))));
		this.loading = false;
		const failed = pages.find((page): page is PromiseRejectedResult => page.status === 'rejected');
		if (failed && pages.every((page) => page.status === 'rejected')) this.loadError = failed.reason instanceof Error ? `The server didn’t send them: ${failed.reason.message}` : 'The server didn’t send them.';
		this.loads++;
	}
}

/** The most recently active first, those with no activity known last. */
function byActivity(a: RoomSnapshot, b: RoomSnapshot): number {
	if (a.latestLogId === b.latestLogId) return 0;
	if (a.latestLogId === undefined) return 1;
	if (b.latestLogId === undefined) return -1;
	return compareLogIds(b.latestLogId, a.latestLogId);
}
