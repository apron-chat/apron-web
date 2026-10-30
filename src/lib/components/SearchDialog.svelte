<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import AutocompletePicker from './AutocompletePicker.svelte';
	import SearchPanel from '$lib/design/components/SearchPanel.svelte';
	import type { SearchResult } from '$lib/design/components/types';
	import { times } from '$lib/design/components/util';
	import type { HistoryKeeper } from '$lib/history/history-keeper';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import { isSystemId, type MessageRecord } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { plainTextOf, senderName } from '$lib/ui/messages';
	import { searchRooms, type RoomSuggestion } from '$lib/ui/room-autocomplete';
	import { filterAtCaret, newestMatches, parseQuery, queryMatcher, searchPeople, snippet, withFilterValue, type SearchQuery } from '$lib/ui/search';
	import { dayLabelOf } from '$lib/ui/time';

	/**
	 * Search local history (`$lib/ui/search`): what this server's history keeps on this device (`keeper`), and what the
	 * page holds, as the query is typed, narrowed by its `user:` and `room:` filters. A result picked opens where it
	 * is (`onopen`).
	 */
	interface Props {
		client: ChatClient;
		/** What keeps history on this device, while it keeps this session's; none against an in-memory server. */
		keeper?: HistoryKeeper;
		/** The rooms shown, for naming where a result is. */
		rooms: RoomSnapshot[];
		/** The rooms `room:` suggests, as the composer's `#` does: those shown, and those listed to join. */
		roomSuggestions: RoomSuggestion[];
		/** What is searched, in words, under the field. */
		note?: string;
		/** What the field starts with, the caret after it: such as the open room's filter, `room:#general `. */
		initial?: string;
		onopen: (message: MessageRecord) => void;
		/** The title's "history" link: Preferences, at History. */
		onhistory?: () => void;
		onclose: () => void;
	}
	let { client, keeper, rooms, roomSuggestions, note, initial = '', onopen, onhistory, onclose }: Props = $props();

	/** How long typing pauses before a search starts. */
	const SEARCH_DELAY_MS = 150;

	let open = $state(true);
	let query = $state(untrack(() => initial));
	let found = $state.raw<MessageRecord[]>([]);
	let more = $state(false);
	let searching = $state(false);
	/** Counts searches: one that a newer one replaced stops, and its results go unshown. */
	let generation = 0;

	let panel = $state<SearchPanel | undefined>();
	let caret = $state(untrack(() => initial.length));

	// What it starts with stays: the caret goes after it, ready for words.
	onMount(() => void panel?.place(query.length));

	// --- Suggesting a filter's value, as the composer suggests a mention ---

	/** The `user:` or `room:` value the caret is in. */
	let at = $derived(filterAtCaret(query, caret));
	/** The users met, as they change while it is open. */
	let users = $state.raw(untrack(() => client.snapshot().users));
	onMount(() => client.subscribe((snapshot) => (users = snapshot.users)));
	/** Everyone met, but the system identities, as the composer's `@` lists them. */
	let peopleFound = $derived(at?.kind === 'users' ? searchPeople(Object.values(users).filter((user) => !isSystemId(user.user_id)).map((user) => ({ id: user.user_id, name: user.name, avatar: directory.avatar(user) })), at.typed) : []);
	let roomsFound = $derived(at?.kind === 'rooms' ? searchRooms(roomSuggestions, at.typed) : []);
	let suggested = $derived(at?.kind === 'users' ? peopleFound.length : roomsFound.length);
	/** The query as it was when Escape put the suggestions away: they come back once it changes. */
	let dismissed = $state<string | undefined>();
	let suggesting = $derived(at !== undefined && suggested > 0 && dismissed !== query);
	/** The suggestion the keyboard is on. */
	let picking = $state(0);
	const pickerId = $props.id();

	// What's typed of the value changed: the keyboard goes back to the first suggestion.
	$effect(() => {
		void at?.start;
		void at?.typed;
		picking = 0;
	});

	/** The field's keys, while suggestions show: ↑ ↓ move, Enter or Tab takes one, Escape puts them away. */
	function fieldKey(event: KeyboardEvent): boolean {
		if (!suggesting) return false;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			picking = event.key === 'ArrowDown' ? Math.min(picking + 1, suggested - 1) : Math.max(picking - 1, 0);
		} else if (event.key === 'Enter' || event.key === 'Tab') {
			take(picking);
		} else if (event.key === 'Escape') {
			dismissed = query;
		} else {
			return false;
		}
		event.preventDefault();
		return true;
	}

	/** Puts the suggestion at `index` in as the filter's value: `@user_id` or `#room_id`. */
	function take(index: number): void {
		const id = at?.kind === 'users' ? peopleFound[index]?.id : roomsFound[index]?.id;
		if (!at || id === undefined) return;
		const next = withFilterValue(query, at, `${at.kind === 'users' ? '@' : '#'}${id}`);
		query = next.query;
		void panel?.place(next.caret);
	}

	/** What is typed, read: its words, and its `user:` and `room:` filters. */
	let parsed = $derived(parseQuery(query));

	$effect(() => {
		const asked = parsed;
		const run = ++generation;
		if (!asked.text && !asked.users.length && !asked.rooms.length) {
			found = [];
			more = false;
			searching = false;
			return;
		}
		searching = true;
		const timer = setTimeout(() => void search(asked, run), SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function search(asked: SearchQuery, run: number): Promise<void> {
		const test = queryMatcher(asked, { users: Object.values(client.snapshot().users), rooms, parentOf: (roomId) => client.roomRecord(roomId)?.parent_room_id });
		if (!test) return;
		const loaded = client.storedRecords().messages.filter(test);
		// Only the signed-in account's: each account's kept history is a database of its own.
		const you = client.snapshot().you?.user_id;
		const kept = keeper && you !== undefined ? await keeper.searchKept(client.url, you, test, () => run !== generation) : [];
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
		const text = parsed.text;
		return found.map((message) => {
			const at = times(Number(message.message_id));
			const day = dayLabelOf(message.message_id);
			return {
				id: message.message_id,
				room: placeOf(message.room_id),
				who: senderName(message),
				...(day ? { when: `${day} ${at.short ?? ''}`.trim() } : {}),
				...(at.exact ? { exact: at.exact } : {}),
				parts: snippet(plainTextOf(message), text)
			};
		});
	});

	function pick(id: string): void {
		const message = found.find((candidate) => candidate.message_id === id);
		if (message) onopen(message);
	}
</script>

<SearchPanel bind:this={panel} bind:open bind:query bind:caret onfieldkey={fieldKey} suggesting={suggesting ? { list: pickerId, option: `${pickerId}-${picking}` } : undefined} {results} {searching} {more} {note} placeholder="Words, user:@name, room:#name" {onhistory} onpick={pick} {onclose} listTestid="search-results" >
	{#snippet suggestions()}
		{#if suggesting && at?.kind === 'users'}
			<AutocompletePicker id={pickerId} query={at.typed} people={peopleFound} active={picking} testid="search-suggestions" onpick={take} onhover={(index) => (picking = index)} />
		{:else if suggesting && at}
			<AutocompletePicker id={pickerId} query={at.typed} rooms={roomsFound} active={picking} testid="search-suggestions" onpick={take} onhover={(index) => (picking = index)} />
		{/if}
	{/snippet}
</SearchPanel>
