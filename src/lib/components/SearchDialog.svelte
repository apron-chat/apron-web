<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import AutocompletePicker from './AutocompletePicker.svelte';
	import SearchPanel from '$lib/design/components/SearchPanel.svelte';
	import type { SearchMode, SearchResult } from '$lib/design/components/types';
	import { times } from '$lib/design/components/util';
	import type { HistoryKeeper } from '$lib/history/history-keeper';
	import type { ChatClient, RoomListing, RoomSnapshot } from '$lib/protocol/client';
	import { isSystemId, type MessageRecord } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { MessageSearch } from '$lib/ui/message-search.svelte';
	import { plainTextOf, senderName } from '$lib/ui/messages';
	import { searchRooms, type RoomSuggestion } from '$lib/ui/room-autocomplete';
	import { RoomFinder } from '$lib/ui/room-finder.svelte';
	import { filterAtCaret, parseQuery, searchPeople, snippet, withFilterValue } from '$lib/ui/search';
	import { dayLabelOf } from '$lib/ui/time';

	/**
	 * Search Local History, in two modes, which keep what's typed between them: rooms and threads by name
	 * (`RoomFinder`), and messages (`MessageSearch`). This is the field's side of both: the mode, its `user:` and
	 * `room:` suggestions, its keys, and what a pick opens.
	 */
	interface Props {
		client: ChatClient;
		/** Which it opens on. */
		mode: 'rooms' | 'messages';
		/** What keeps history on this device, while it keeps this session's; none against an in-memory server. */
		keeper?: HistoryKeeper;
		/** The rooms shown: joined, or open without joining. */
		rooms: RoomSnapshot[];
		/** The rooms listed to join (`room_list` `not_joined`, §4.2.1), and each room's threads listed to join. */
		listed?: RoomListing[];
		threadsListed?: Record<string, RoomListing[]>;
		/** What's new in each room, by `room_id`, as the rooms list counts it. */
		unread?: Record<string, number>;
		mentions?: Record<string, number>;
		/** The server lists rooms (capability `rooms`): a room's threads you haven't joined are listed once `room:` names it. */
		canList?: boolean;
		/** The rooms `room:` suggests, as the composer's `#` does: those shown, and those listed to join. */
		roomSuggestions: RoomSuggestion[];
		/** What is searched, in words, under the field, for messages. */
		note?: string;
		/** What the field starts with for messages, the caret after it: such as the open room's filter, `room:#general `. */
		initial?: string;
		/** Each mode's shortcut, as the platform writes it ("⌘K", "Ctrl F"); none on a touch screen. */
		keys?: { rooms: string; messages: string };
		onopen: (message: MessageRecord) => void;
		/** A room or thread picked, by its `room_id`: it opens, joined or to read. */
		onopenroom: (roomId: string) => void;
		/** How far back history is kept, beside the title ("30 Days"), and pressing it: Preferences, at History. */
		kept?: string;
		onhistory?: () => void;
		onclose: () => void;
	}
	let { client, mode: opening, keeper, rooms, listed = [], threadsListed = {}, unread = {}, mentions = {}, canList = false, roomSuggestions, note, initial = '', keys, onopen, onopenroom, kept, onhistory, onclose }: Props = $props();

	let open = $state(true);
	let mode = $state(untrack(() => opening));
	let query = $state(untrack(() => (opening === 'messages' ? initial : '')));
	let panel = $state<SearchPanel | undefined>();
	let caret = $state(untrack(() => query.length));

	// What it starts with stays: the caret goes after it, ready for words.
	onMount(() => void panel?.place(query.length));

	/** What is typed, read: its words, and its `user:` and `room:` filters. */
	let parsed = $derived(parseQuery(query));
	/** The users met, as they change while it is open. */
	let users = $state.raw(untrack(() => client.snapshot().users));
	onMount(() => client.subscribe((snapshot) => (users = snapshot.users)));

	const messages = new MessageSearch({
		get client() { return client; },
		get keeper() { return keeper; },
		get rooms() { return rooms; },
		get query() { return parsed; },
		get active() { return mode === 'messages'; }
	});
	const finder = new RoomFinder({
		get client() { return client; },
		get rooms() { return rooms; },
		get listed() { return listed; },
		get threadsListed() { return threadsListed; },
		get unread() { return unread; },
		get mentions() { return mentions; },
		get you() { return directory.you; },
		get query() { return parsed; },
		get active() { return mode === 'rooms'; },
		get canList() { return canList; }
	});

	/** How `aria-keyshortcuts` names the platform's modifier. */
	const modifier = $derived(keys?.rooms.startsWith('⌘') ? 'Meta' : 'Control');
	const modes = $derived<SearchMode[]>([
		{ id: 'rooms', label: 'Rooms and threads', ...(keys ? { keys: keys.rooms, shortcut: `${modifier}+K` } : {}) },
		{ id: 'messages', label: 'Messages', ...(keys ? { keys: keys.messages, shortcut: `${modifier}+F` } : {}) }
	]);

	/**
	 * Ctrl/⌘K and Ctrl/⌘F switch to rooms and to messages, wherever the keyboard is in the dialog: the page's own
	 * shortcuts stand aside while a dialog is open, and the browser's would open its find bar or search box.
	 */
	function switchKey(event: KeyboardEvent): void {
		if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
		const key = event.key.toLowerCase();
		if (key !== 'k' && key !== 'f') return;
		event.preventDefault();
		mode = key === 'k' ? 'rooms' : 'messages';
	}

	// --- Suggesting a filter's value, as the composer suggests a mention ---

	/** The `user:` or `room:` value the caret is in; rooms are found by `room:` alone. */
	let at = $derived.by(() => {
		const value = filterAtCaret(query, caret);
		return value?.kind === 'users' && mode === 'rooms' ? undefined : value;
	});
	/** Everyone met, but the system identities, as the composer's `@` lists them. */
	let peopleFound = $derived(at?.kind === 'users' ? searchPeople(Object.values(users).filter((user) => !isSystemId(user.user_id)).map((user) => ({ id: user.user_id, name: user.name, avatar: directory.avatar(user) })), at.typed) : []);
	// Finding rooms, `room:` names a room whose threads are searched: a thread has none.
	let roomsFound = $derived(at?.kind === 'rooms' ? searchRooms(mode === 'rooms' ? roomSuggestions.filter((room) => finder.byId.get(room.id)?.parentRoomId === undefined) : roomSuggestions, at.typed) : []);
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

	/**
	 * The field's keys. While suggestions show: ↑ ↓ move, Enter or Tab takes one, Escape puts them away. Finding rooms,
	 * → at the end of the field on a room searches its threads (`room:#id `), and Backspace there takes that away again.
	 */
	function fieldKey(event: KeyboardEvent, active: string | undefined): boolean {
		if (suggesting) {
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
		if (mode !== 'rooms' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
		const field = event.target as HTMLInputElement;
		const atEnd = field.selectionStart === query.length && field.selectionEnd === query.length;
		if (event.key === 'ArrowRight' && atEnd && active !== undefined) {
			const room = finder.byId.get(active);
			if (!room || room.parentRoomId !== undefined) return false;
			event.preventDefault();
			query = `room:#${room.id} `;
			void panel?.place(query.length);
			return true;
		}
		if (event.key === 'Backspace' && atEnd && /^room:(?:#?\S+|"[^"]*") $/i.test(query)) {
			event.preventDefault();
			query = '';
			void panel?.place(0);
			return true;
		}
		return false;
	}

	/** Puts the suggestion at `index` in as the filter's value: `@user_id` or `#room_id`. */
	function take(index: number): void {
		const id = at?.kind === 'users' ? peopleFound[index]?.id : roomsFound[index]?.id;
		if (!at || id === undefined) return;
		const next = withFilterValue(query, at, `${at.kind === 'users' ? '@' : '#'}${id}`);
		query = next.query;
		void panel?.place(next.caret);
	}

	// --- Results ---

	/** Where a message is: its room's title, or a thread's with its room's after it. */
	function placeOf(roomId: string): string {
		const room = rooms.find((candidate) => candidate.id === roomId);
		if (!room) return roomId;
		const parent = room.parentRoomId === undefined ? undefined : rooms.find((candidate) => candidate.id === room.parentRoomId);
		return parent ? `${room.title} · ${parent.title}` : room.title;
	}

	let messageResults = $derived.by((): SearchResult[] => {
		const text = parsed.text;
		return messages.found.map((message) => {
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
		if (mode === 'rooms') {
			onopenroom(id);
			return;
		}
		const message = messages.found.find((candidate) => candidate.message_id === id);
		if (message) onopen(message);
	}
</script>

<svelte:window onkeydown={switchKey} />

<SearchPanel
	bind:this={panel} bind:open bind:query bind:caret bind:mode {modes} kind={mode}
	onfieldkey={fieldKey} suggesting={suggesting ? { list: pickerId, option: `${pickerId}-${picking}` } : undefined}
	results={mode === 'rooms' ? finder.results : messageResults} searching={mode === 'messages' && messages.searching}
	more={mode === 'rooms' ? (finder.found?.total ?? 0) > finder.results.length : messages.more}
	note={mode === 'rooms' ? 'Those you’ve joined first. → on a room searches its threads.' : note}
	placeholder={mode === 'rooms' ? 'A room or thread, room:#name for its threads' : 'Words, user:@name, room:#name'}
	foot={mode === 'rooms' ? finder.foot : messages.foot}
	{kept} {onhistory} onpick={pick} {onclose} listTestid="search-results"
>
	{#snippet suggestions()}
		{#if suggesting && at?.kind === 'users'}
			<AutocompletePicker id={pickerId} query={at.typed} people={peopleFound} active={picking} testid="search-suggestions" onpick={take} onhover={(index) => (picking = index)} />
		{:else if suggesting && at}
			<AutocompletePicker id={pickerId} query={at.typed} rooms={roomsFound} active={picking} testid="search-suggestions" onpick={take} onhover={(index) => (picking = index)} />
		{/if}
	{/snippet}
</SearchPanel>
