<script lang="ts">
	import SearchPanel from '$lib/design/components/SearchPanel.svelte';
	import type { SearchResult } from '$lib/design/components/types';
	import { times } from '$lib/design/components/util';
	import type { HistoryKeeper } from '$lib/history/history-keeper';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import type { MessageRecord } from '$lib/protocol/types';
	import { plainTextOf, senderName } from '$lib/ui/messages';
	import { matchesTerms, newestMatches, searchTerms, snippet } from '$lib/ui/search';
	import { dayLabelOf } from '$lib/ui/time';

	/**
	 * Search messages (`$lib/ui/search`): what this server's history keeps on this device (`keeper`), and what the
	 * page holds, as the query is typed. A result picked opens where it is (`onopen`).
	 */
	interface Props {
		client: ChatClient;
		/** What keeps history on this device; none against an in-memory server. */
		keeper?: HistoryKeeper;
		/** The rooms shown, for naming where a result is. */
		rooms: RoomSnapshot[];
		/** What is searched, in words, under the field. */
		note?: string;
		onopen: (message: MessageRecord) => void;
		onclose: () => void;
	}
	let { client, keeper, rooms, note, onopen, onclose }: Props = $props();

	/** How long typing pauses before a search starts. */
	const SEARCH_DELAY_MS = 150;

	let open = $state(true);
	let query = $state('');
	let found = $state.raw<MessageRecord[]>([]);
	let more = $state(false);
	let searching = $state(false);
	/** Counts searches: one that a newer one replaced stops, and its results go unshown. */
	let generation = 0;

	$effect(() => {
		const terms = searchTerms(query);
		const run = ++generation;
		if (!terms.length) {
			found = [];
			more = false;
			searching = false;
			return;
		}
		searching = true;
		const timer = setTimeout(() => void search(terms, run), SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function search(terms: string[], run: number): Promise<void> {
		const test = (message: MessageRecord) => matchesTerms(message, terms);
		const loaded = client.storedRecords().messages.filter(test);
		const kept = keeper ? await keeper.searchKept(client.url, test, () => run !== generation) : [];
		if (run !== generation) return;
		({ messages: found, more } = newestMatches([kept, loaded]));
		searching = false;
	}

	/** Where a message is: its room's title, or a thread's with its room's after it. */
	function placeOf(roomId: string): string {
		const room = rooms.find((candidate) => candidate.id === roomId);
		if (!room) return roomId;
		const parent = room.parentRoomId === undefined ? undefined : rooms.find((candidate) => candidate.id === room.parentRoomId);
		return parent ? `${room.title} · ${parent.title}` : room.title;
	}

	let results = $derived.by((): SearchResult[] => {
		const terms = searchTerms(query);
		return found.map((message) => {
			const at = times(Number(message.message_id));
			const day = dayLabelOf(message.message_id);
			return {
				id: message.message_id,
				room: placeOf(message.room_id),
				who: senderName(message),
				...(day ? { when: `${day} ${at.short ?? ''}`.trim() } : {}),
				...(at.exact ? { exact: at.exact } : {}),
				parts: snippet(plainTextOf(message), terms)
			};
		});
	});

	function pick(id: string): void {
		const message = found.find((candidate) => candidate.message_id === id);
		if (message) onopen(message);
	}
</script>

<SearchPanel bind:open bind:query {results} {searching} {more} {note} onpick={pick} {onclose} listTestid="search-results" />
