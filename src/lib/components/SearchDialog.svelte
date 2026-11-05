<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import AutocompletePicker from './AutocompletePicker.svelte';
	import SearchPanel from '$lib/design/components/SearchPanel.svelte';
	import type { RoomResult, SearchAction, SearchMode, SearchResult } from '$lib/design/components/types';
	import { times } from '$lib/design/components/util';
	import type { HistoryKeeper } from '$lib/history/history-keeper';
	import type { ChatClient, RoomListing, RoomSnapshot } from '$lib/protocol/client';
	import { markdownText } from '$lib/protocol/markdown';
	import { compareLogIds } from '$lib/protocol/reducer';
	import { isSystemId, type MessageRecord } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { plainTextOf, senderName } from '$lib/ui/messages';
	import { searchRooms, type RoomSuggestion } from '$lib/ui/room-autocomplete';
	import { knownRooms, rankRooms, wantedOf, type KnownRoom } from '$lib/ui/room-search';
	import { filterAtCaret, folded, newestMatches, parseQuery, queryMatcher, searchPeople, snippet, withFilterValue, type SearchQuery } from '$lib/ui/search';
	import { dayLabelOf } from '$lib/ui/time';

	/**
	 * Search, in two modes. Go to a Room or Thread (`rooms`) finds rooms and threads by name among those this page
	 * knows of (`$lib/ui/room-search`): joined first, then those listed to join or kept on this device; `room:`
	 * narrows it to a room's threads, and → on a room does that. Search the Server lists more. Search Local History
	 * (`messages`) finds messages (`$lib/ui/search`): what this server's history keeps on this device (`keeper`), and
	 * what the page holds, as the query is typed, narrowed by its `user:` and `room:` filters; Load More from Server
	 * pages older history into the rooms searched, and searches again. A result picked opens where it is.
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
		/** The top-level room open, whose threads Search the Server lists when `room:` names none. */
		openRoomId?: string;
		/** The server lists rooms (capability `rooms`): Search the Server can ask it. */
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
	let { client, mode: opening, keeper, rooms, listed = [], threadsListed = {}, unread = {}, mentions = {}, openRoomId, canList = false, roomSuggestions, note, initial = '', keys, onopen, onopenroom, kept, onhistory, onclose }: Props = $props();

	/** How long typing pauses before a search starts. */
	const SEARCH_DELAY_MS = 150;
	/** The most rooms one Load More from Server pages back in, the most recently active first. */
	const LOAD_ROOMS = 10;

	let open = $state(true);
	let mode = $state(untrack(() => opening));
	let query = $state(untrack(() => (opening === 'messages' ? initial : '')));
	let found = $state.raw<MessageRecord[]>([]);
	let more = $state(false);
	let searching = $state(false);
	/** Counts searches: one that a newer one replaced stops, and its results go unshown. */
	let generation = 0;

	let panel = $state<SearchPanel | undefined>();
	let caret = $state(untrack(() => query.length));

	// What it starts with stays: the caret goes after it, ready for words.
	onMount(() => void panel?.place(query.length));

	const modes = $derived<SearchMode[]>([
		{ id: 'rooms', label: 'Rooms and threads', ...(keys ? { keys: keys.rooms } : {}) },
		{ id: 'messages', label: 'Messages', ...(keys ? { keys: keys.messages } : {}) }
	]);

	// --- Suggesting a filter's value, as the composer suggests a mention ---

	/** The `user:` or `room:` value the caret is in; rooms are found by `room:` alone. */
	let at = $derived.by(() => {
		const value = filterAtCaret(query, caret);
		return value?.kind === 'users' && mode === 'rooms' ? undefined : value;
	});
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

	/**
	 * The field's keys. While suggestions show: ↑ ↓ move, Enter or Tab takes one, Escape puts them away. Ctrl/⌘K and
	 * Ctrl/⌘F switch to rooms and to messages. Finding rooms, → at the end of the field on a room searches its threads
	 * (`room:#id `), and Backspace there takes that away again.
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
		if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'f')) {
			event.preventDefault();
			mode = event.key.toLowerCase() === 'k' ? 'rooms' : 'messages';
			return true;
		}
		if (mode !== 'rooms' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
		const field = event.target as HTMLInputElement;
		const atEnd = field.selectionStart === query.length && field.selectionEnd === query.length;
		if (event.key === 'ArrowRight' && atEnd && active !== undefined) {
			const room = known.find((candidate) => candidate.id === active);
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

	/** What is typed, read: its words, and its `user:` and `room:` filters. */
	let parsed = $derived(parseQuery(query));

	// --- Rooms and threads ---

	/** Bumped once the server has listed more: the records stored meanwhile are read again. */
	let listings = $state(0);
	/** Every room and thread this page knows of (`knownRooms`). */
	let known = $derived.by(() => {
		void listings;
		return mode === 'rooms' ? knownRooms(rooms, [...listed, ...Object.values(threadsListed).flat()], client.storedRooms()) : [];
	});
	let byId = $derived(new Map(known.map((room) => [room.id, room])));
	/** Rooms muted, whose news shows grey, as in the rooms list. */
	let mutedIds = $derived(new Set(rooms.filter((room) => room.mutedUntil !== undefined).map((room) => room.id)));
	let roomsMatched = $derived(mode === 'rooms' ? rankRooms(known, { text: parsed.text, rooms: parsed.rooms }) : undefined);

	/** A room's line under its title: a thread's room (unless it's the one searched), else what it's about; then when it was last active. */
	function detailOf(room: KnownRoom, scoped: boolean): string | undefined {
		const parent = room.parentRoomId === undefined ? undefined : byId.get(room.parentRoomId)?.title ?? room.parentRoomId;
		const about = room.description ? markdownText(room.description).replace(/\s+/g, ' ').trim() : '';
		const day = room.activeId === undefined ? '' : dayLabelOf(room.activeId);
		return [parent !== undefined && !scoped ? `in ${parent}` : about, day].filter(Boolean).join(' · ') || undefined;
	}

	let roomResults = $derived.by((): RoomResult[] => {
		if (!roomsMatched) return [];
		const scoped = roomsMatched.scope.length === 1;
		const wanted = wantedOf(parsed.text);
		return roomsMatched.rooms.map((room) => {
			const detail = detailOf(room, scoped);
			return {
				kind: 'room', id: room.id, group: room.joined ? 'Joined' : 'Not joined', joined: room.joined,
				parts: snippet(room.title, wanted, 200),
				...(room.parentRoomId !== undefined ? { thread: true } : {}),
				...(detail ? { detail } : {}),
				...(room.private ? { private: true } : {}),
				...(unread[room.id] ? { unread: unread[room.id] } : {}),
				...(mentions[room.id] ? { mentions: mentions[room.id] } : {}),
				...(mutedIds.has(room.id) ? { muted: true } : {})
			};
		});
	});

	/** The room whose threads Search the Server lists: the one `room:` names, else the one open. */
	let listFor = $derived(roomsMatched?.scope[0]?.id ?? openRoomId);
	/** What the server last listed, by `listFor` ('' for none), and whether it's listing. */
	let listedFor = $state<string | undefined>();
	let listing = $state(false);
	let listError = $state('');

	async function searchServer(): Promise<void> {
		const parent = listFor;
		listing = true;
		listError = '';
		const asked = await Promise.allSettled([client.listRooms(undefined, 0), ...(parent !== undefined ? [client.listRooms(parent, 0)] : [])]);
		listing = false;
		listings++;
		const failed = asked.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failed) listError = failed.reason instanceof Error ? `The server didn’t list them: ${failed.reason.message}` : 'The server didn’t list them.';
		else listedFor = parent ?? '';
	}

	let roomAction = $derived.by((): SearchAction | undefined => {
		if (mode !== 'rooms' || !canList) return undefined;
		const parent = listFor === undefined ? undefined : byId.get(listFor)?.title ?? listFor;
		const done = listedFor === (listFor ?? '');
		const note = listError || (done
			? `The server listed its most active rooms${parent ? `, and ${parent}’s threads` : ''}. Rooms it didn’t list aren’t found.`
			: `Searched ${known.length === 1 ? '1 room or thread' : `${known.length.toLocaleString()} rooms and threads`} this page knows of.`);
		return { label: 'Search the Server', note, busy: listing, done, onclick: () => void searchServer() };
	});

	// --- Messages ---

	/** Bumped once older pages have loaded: the same query searches again, now with them. */
	let loads = $state(0);

	$effect(() => {
		const asked = parsed;
		void loads;
		const run = ++generation;
		if (mode !== 'messages' || (!asked.text && !asked.users.length && !asked.rooms.length)) {
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

	/** The rooms a message search looks through, shown here: those `room:` names, with their threads, else every one you've joined. */
	let searchedRooms = $derived.by(() => {
		if (mode !== 'messages') return [];
		if (!parsed.rooms.length) return rooms.filter((room) => room.joined);
		const named = new Set(rooms.filter((room) => parsed.rooms.some((value) => folded(room.id) === value || folded(room.title) === value)).map((room) => room.id));
		return rooms.filter((room) => named.has(room.id) || (room.parentRoomId !== undefined && named.has(room.parentRoomId)));
	});
	/** Of those, the ones the server has older history for: never loaded (a thread loads when opened), or with older pages. */
	let older = $derived(searchedRooms.filter((room) => !room.recoveryError && !room.loading && !room.loadingOlder && (!room.loaded || room.olderAvailable)));
	let loadingOlder = $state(false);
	let loadError = $state('');

	/** A page further back in each of the LOAD_ROOMS most recently active rooms with more, and the search again. */
	async function loadMore(): Promise<void> {
		const next = older.toSorted((a, b) => (a.latestLogId === b.latestLogId ? 0 : a.latestLogId === undefined ? 1 : b.latestLogId === undefined ? -1 : compareLogIds(b.latestLogId, a.latestLogId))).slice(0, LOAD_ROOMS);
		loadingOlder = true;
		loadError = '';
		const pages = await Promise.allSettled(next.map((room) => (room.loaded ? client.loadOlder(room.id) : client.loadRoom(room.id))));
		loadingOlder = false;
		const failed = pages.find((page): page is PromiseRejectedResult => page.status === 'rejected');
		if (failed && pages.every((page) => page.status === 'rejected')) loadError = failed.reason instanceof Error ? `The server didn’t send them: ${failed.reason.message}` : 'The server didn’t send them.';
		loads++;
	}

	let messageAction = $derived.by((): SearchAction | undefined => {
		if (mode !== 'messages' || (!parsed.text && !parsed.users.length && !parsed.rooms.length) || !searchedRooms.length) return undefined;
		const where = parsed.rooms.length && searchedRooms.length ? `${searchedRooms.find((room) => room.parentRoomId === undefined)?.title ?? searchedRooms[0].title}` : 'your rooms';
		const done = !older.length && !loadingOlder;
		const note = loadError || (done ? `Everything the server has in ${where} is loaded, and searched.` : `Older messages in ${where} are on the server.`);
		return { label: 'Load More from Server', note, busy: loadingOlder, done, onclick: () => void loadMore() };
	});

	/** Where a message is: its room's title, or a thread's with its room's after it. */
	function placeOf(roomId: string): string {
		const room = rooms.find((candidate) => candidate.id === roomId);
		if (!room) return roomId;
		const parent = room.parentRoomId === undefined ? undefined : rooms.find((candidate) => candidate.id === room.parentRoomId);
		return parent ? `${room.title} · ${parent.title}` : room.title;
	}

	let messageResults = $derived.by((): SearchResult[] => {
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
		if (mode === 'rooms') {
			onopenroom(id);
			return;
		}
		const message = found.find((candidate) => candidate.message_id === id);
		if (message) onopen(message);
	}
</script>

<SearchPanel
	bind:this={panel} bind:open bind:query bind:caret bind:mode {modes} kind={mode}
	title={mode === 'rooms' ? 'Go to a Room or Thread' : 'Search Local History'}
	onfieldkey={fieldKey} suggesting={suggesting ? { list: pickerId, option: `${pickerId}-${picking}` } : undefined}
	results={mode === 'rooms' ? roomResults : messageResults} searching={mode === 'messages' && searching} more={mode === 'rooms' ? (roomsMatched?.total ?? 0) > roomResults.length : more}
	note={mode === 'rooms' ? 'Rooms and threads you’ve joined first. → on a room searches its threads.' : note}
	placeholder={mode === 'rooms' ? 'A room or thread, room:#name for its threads' : 'Words, user:@name, room:#name'}
	action={mode === 'rooms' ? roomAction : messageAction}
	kept={mode === 'messages' ? kept : undefined} {onhistory} onpick={pick} {onclose} listTestid="search-results"
>
	{#snippet suggestions()}
		{#if suggesting && at?.kind === 'users'}
			<AutocompletePicker id={pickerId} query={at.typed} people={peopleFound} active={picking} testid="search-suggestions" onpick={take} onhover={(index) => (picking = index)} />
		{:else if suggesting && at}
			<AutocompletePicker id={pickerId} query={at.typed} rooms={roomsFound} active={picking} testid="search-suggestions" onpick={take} onhover={(index) => (picking = index)} />
		{/if}
	{/snippet}
</SearchPanel>
