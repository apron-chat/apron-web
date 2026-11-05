<script lang="ts">
	import { directory } from '$lib/ui/directory.svelte';
	import { newRoomDialog } from './lazy';
	import { tick, untrack } from 'svelte';
	import type { ChatClient, RoomSnapshot, ServerLook } from '$lib/protocol/client';
	import type { SessionView } from '$lib/ui/session.svelte';
	import type { NotificationPermissionState, NotificationTestResult } from '$lib/ui/notifications';
	import type { WebPushPreference } from '$lib/ui/web-push';
	import type { PausedUntil } from '$lib/ui/pause';
	import { sidebarSections, threadsWithNews, type ThreadEntry } from '$lib/ui/timeline';
	import { roomFaces } from '$lib/ui/faces';
	import type { Face } from '$lib/design/components/types';
	import { listInBackground } from '$lib/ui/background-listing';
	import { loadSidebarFolds, loadThreadFolds, saveSidebarFolds, saveThreadFolds } from '$lib/ui/storage';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { flip } from 'svelte/animate';
	import type { ActionReturn } from 'svelte/action';
	import { roomDrag } from './lazy';
	import { RoomOrder } from '$lib/ui/room-order.svelte';
	import type { SignOutHandler } from '$lib/ui/sign-in';
	import type { KeptHistoryControls } from '$lib/history/history-keeper';
	import ProfileBar from './ProfileBar.svelte';
	import ThreadList from './ThreadList.svelte';
	import RoomItem from '$lib/design/components/RoomItem.svelte';
	import SidebarHead from '$lib/design/components/SidebarHead.svelte';
	import { serverPane } from '$lib/ui/server-pane.svelte';
	import SidebarSection from '$lib/design/components/SidebarSection.svelte';

	interface Props {
		client: ChatClient;
		session: SessionView;
		backendLabel: string;
		/** How the server shows itself (§3.1): its title in place of `backendLabel`, and its avatar. */
		serverLook?: ServerLook;
		/** The server's address (§1), the head's tooltip. */
		serverAddress?: string;
		/** Whose folded rooms are kept on this device (`notifyAccount`); without one they're kept for this page only. */
		account?: string;
		/** The top-level rooms' order, kept by the page for the account; its own, for this page only, without one. */
		order?: RoomOrder;
		/** The active room's threads (rooms whose parent it is) to list under it: joined ones, and the open one. */
		threads: ThreadEntry[];
		activeThread?: string;
		/** Mentions of you that landed in rooms you weren't reading. */
		mentions: Record<string, number>;
		/** Messages from others that landed in rooms and threads you weren't reading. */
		unread: Record<string, number>;
		displayName: string;
		passkeyUnavailable?: string;
		notificationsEnabled: boolean;
		notificationsSupported: boolean;
		notificationPermission: NotificationPermissionState;
		/** What to notify about (`NOTIFY_SCOPES`), for desktop notifications and push alike. */
		notifyScopes: string[];
		onnotifications: () => void;
		onnotifyscopes: (scopes: string[]) => void;
		ontestnotifications: () => Promise<NotificationTestResult>;
		/** Push notifications (§4.9), when the server offers web push. */
		webPush?: WebPushPreference;
		onwebpush: () => void;
		/** Chromium's install prompt, from the push setting. */
		oninstallapp: () => void;
		/** Pausing notifications (§4.5 `mute`), on a server with capability `status`. */
		pause?: { until?: PausedUntil };
		onpause: (until: PausedUntil) => Promise<void> | void;
		onresume: () => Promise<void> | void;
		/** The room or thread the phone's rooms list opened over, and the › back to it. */
		returnTo?: string;
		onreturn?: () => void;
		onroom: (room: RoomSnapshot) => void;
		onthread: (thread: string) => void;
		/** Reads a thread of the active room that you haven't joined, without joining it. */
		onopenthread: (thread: string) => void;
		/** Join a visible room or thread from `room_list` (capability `rooms`); it opens once its `room_update` arrives. */
		onjoin: (roomId: string) => void;
		/** Reads a room under Other Rooms without joining it: its header's Join, or posting there, joins it. */
		onopenroom: (roomId: string) => void;
		/** Leave a thread of the active room (capability `rooms`). */
		onleavethread: (thread: string) => void;
		/** A room created here, asked for as private or not; it opens once its `room_update` arrives. */
		oncreateroom: (roomId: string, options: { private: boolean }) => void;
		/** The + on the active room's row: start a thread in it, named in the page's NewThreadDialog. */
		onnewthread: (room: RoomSnapshot) => void;
		/** The + beside Private, for a signed-in account: start a private conversation, in the page's NewPrivateDialog. */
		onnewprivate?: () => void;
		onsignout: SignOutHandler;
		/** The history kept on this device, for Profile's Sign out and Preferences' History; none before it is ready. */
		keptHistory?: KeptHistoryControls;
		/** Opens the connect screen to sign in with a passkey, carrying a handle typed in the profile. */
		/** Opens the connect screen to sign in; none where the page has no connect screen (an export read, the preview). */
		onsignin?: (name?: string, scheme?: 'webauthn' | 'email' | 'external') => void;
		/**
		 * Draw the rooms (default): until then the list holds none, for one out of sight (behind a phone's conversation,
		 * or shut) while the first screen draws. Its header, profile bar and background listings are there regardless.
		 */
		drawRooms?: boolean;
	}
	let { drawRooms = true, client, session, backendLabel, serverLook, serverAddress, account, order = new RoomOrder(), threads, activeThread, mentions, unread, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, returnTo, onreturn, onroom, onthread, onopenthread, onjoin, onopenroom, onleavethread, oncreateroom, onnewthread, onnewprivate, onsignout, keptHistory, onsignin }: Props = $props();
	/** The head's server button: the server pane sits beside it. */
	let serverHead = $state<HTMLButtonElement | undefined>();
	/** Threads are listed under their parent, not as rooms of their own; private rooms in a list of their own. */
	let sections = $derived(sidebarSections(session.rooms));
	/** Each in the order kept on this device: the order rooms arrive in is the server's, and may differ on each visit. */
	let rooms = $derived(order.sort(sections.rooms));
	let privateRooms = $derived(order.sort(sections.private));
	// A room listed for the first time takes the next place, so the order holds from then on.
	$effect(() => {
		void order.order;
		const listed = [...sections.rooms, ...sections.private].map((room) => room.id);
		untrack(() => order.adopt(listed));
	});

	/**
	 * Dragging a room to another place in its section (`room-drag.ts`): by its row, with a mouse once it moves, or held
	 * on a touch screen for `HOLD_MS`, when it lifts; a shorter touch scrolls or picks it. While one is carried every room's
	 * threads fold away, so the list is just its rooms, and come back as they were once it's dropped. It stays in its
	 * section's column, so it lands where it's seen: there's nowhere else to take it.
	 */
	const HOLD_MS = 350;
	/** How far the mouse moves with the button down before a room lifts: further than a click drifts. */
	const MOUSE_SLOP = 8;
	/** When a pointer over the room lists last asked for the drag code; it asks again only after `DRAG_ASK_EVERY_MS`. */
	let dragAskedAt = -Infinity;
	const DRAG_ASK_EVERY_MS = 30_000;
	/**
	 * Makes a section's list one rooms are dragged in, once the drag code has come: it's in the on-demand chunk, fetched
	 * shortly after the page settles, or as soon as a pointer comes over the list, so it adds nothing to what the page
	 * loads to start. Until then a room can't be dragged (Alt+↑/↓ still move it, and a click still opens it). The list is
	 * marked `data-reorderable` once it can.
	 */
	function reorderable(node: HTMLElement, section: Section): ActionReturn<Section> {
		let drag: { destroy(): void } | undefined;
		let gone = false;
		// Asked by either list, at most every 30 s: a load that failed (offline, say) is tried again by a later pointer, or
		// by anything else that loads the chunk (a dialog opening), not by every pointer that crosses a row, each of which
		// would fetch again (and say Apron was updated).
		const ask = () => {
			if (performance.now() - dragAskedAt < DRAG_ASK_EVERY_MS) return;
			dragAskedAt = performance.now();
			roomDrag.load().catch(() => undefined);
		};
		node.addEventListener('pointerover', ask);
		void roomDrag.whenLoaded().then((dragRooms) => {
			if (gone) return;
			node.removeEventListener('pointerover', ask);
			drag = dragRooms(node, { holdMs: HOLD_MS, slopPx: MOUSE_SLOP, settleMs: FLIP_MS, onlift: () => carry(section), onmove: (ids) => carry(section, ids), ondrop: (id, ids) => drop(section, id, ids) });
			node.dataset.reorderable = '';
		});
		return {
			destroy() {
				gone = true;
				node.removeEventListener('pointerover', ask);
				drag?.destroy();
			}
		};
	}
	/** How long the other rooms take to make way, and the one let go to slide into its place; none for reduced motion. */
	const FLIP_MS = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150;
	type Section = 'rooms' | 'private';
	/** Each section's rooms while one is carried in it, as they'd land; none between drags. */
	let carried = $state.raw<Partial<Record<Section, RoomSnapshot[]>>>({});
	let reordering = $derived(Object.keys(carried).length > 0);
	/**
	 * Each section's rooms as last listed, kept while their ids and order hold: the list's `animate:` reads every row's
	 * place before and after each change to it, while nearly every change (a message, an unread count) leaves the rooms
	 * where they were. Rows take their room as it is now from `session.room`. Not state: it only remembers what was shown.
	 */
	const listed: Partial<Record<Section, RoomSnapshot[]>> = {};
	function steady(section: Section, list: RoomSnapshot[]): RoomSnapshot[] {
		const last = listed[section];
		if (last && last.length === list.length && last.every((room, index) => room.id === list[index].id)) return last;
		return (listed[section] = list);
	}
	/** A room lifted in `section` (no `ids`), or carried on to where it would land among them. */
	function carry(section: Section, ids?: string[]): void {
		const rooms = carried[section] ?? listed[section] ?? [];
		const byId = new Map(rooms.map((room) => [room.id, room]));
		carried = { ...carried, [section]: ids ? ids.flatMap((id) => byId.get(id) ?? []) : rooms };
	}
	/** Dropped: next to the room shown before it in its section (or after it, at the top), so the ones a folded section hides keep their places. */
	function drop(section: Section, id: string, ids: string[] | undefined): void {
		const { [section]: _done, ...rest } = carried;
		carried = rest;
		if (!ids) return;
		const at = ids.indexOf(id);
		if (at > 0) order.move(id, ids[at - 1], 'after');
		else if (ids.length > 1) order.move(id, ids[1], 'before');
	}
	/** What the last keyboard move did, for assistive tech. */
	let moved = $state('');
	/** Alt+↑ or Alt+↓ on a room moves it a place up or down among those `shown` with it, and keeps the keyboard on it. */
	function reorderKey(event: KeyboardEvent, shownRooms: RoomSnapshot[]): void {
		if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
		const button = event.target as HTMLElement;
		const id = button.matches('button[data-room]') ? button.dataset.room : undefined;
		if (id === undefined) return;
		event.preventDefault();
		const ids = shownRooms.map((room) => room.id);
		const up = event.key === 'ArrowUp';
		if (!order.step(id, ids, up ? -1 : 1)) return;
		const room = shownRooms.find((other) => other.id === id)!;
		const place = ids.indexOf(id) + (up ? 0 : 2);
		moved = `${room.title} moved ${up ? 'up' : 'down'}, ${place} of ${ids.length}`;
		// Moving its row in the page takes the keyboard off it: put it back.
		void tick().then(() => document.querySelector<HTMLElement>(`button[data-room="${CSS.escape(id)}"]`)?.focus());
	}

	let canBrowse = $derived(session.canManageRooms && session.steady);
	/**
	 * The sections folded to their rows with news, as picking the open room folds its threads: each keeps the rooms with
	 * unread messages or mentions, in them or their threads, and the open one, which reading would otherwise take away
	 * (Other Rooms, whose rooms have no news, the one open to read without joining). All open from the start, and kept as
	 * left, on this device.
	 */
	let folds = $state(new Set(loadSidebarFolds()));
	function fold(key: string, shut: boolean): void {
		const next = new Set(folds);
		if (shut) next.add(key);
		else next.delete(key);
		folds = next;
		saveSidebarFolds([...next]);
	}
	const newsIn = (id: string) => (unread[id] ?? 0) > 0 || (mentions[id] ?? 0) > 0;
	/**
	 * Each room's threads, in the order of `session.rooms`: grouped once per snapshot, where each row looking
	 * through every room for its own would take rooms × rooms for the list.
	 */
	let threadsOf = $derived.by(() => {
		const byParent = new Map<string, RoomSnapshot[]>();
		for (const room of session.rooms) {
			if (room.parentRoomId === undefined) continue;
			const list = byParent.get(room.parentRoomId);
			if (list) list.push(room);
			else byParent.set(room.parentRoomId, [room]);
		}
		return byParent;
	});
	/** News in the room, or in a thread of it you've joined (as `threadsWithNews` counts them, without building their entries). */
	const hasNews = (room: { id: string }) => newsIn(room.id) || (threadsOf.get(room.id) ?? []).some((thread) => thread.joined && newsIn(thread.id));
	const shown = <T extends { id: string }>(list: T[], key: string) => (folds.has(key) ? list.filter((room) => room.id === session.activeRoomId || hasNews(room)) : list);
	let listError = $state('');
	let createOpen = $state(false);
	/** Joining and leaving threads (capability `rooms`, not read-only). */
	let canJoinThreads = $derived(!session.readOnly && session.canManageRooms);
	let canCreateRoom = $derived(session.canManageRooms && session.steady && !session.readOnly);
	/** Visible rooms this user hasn't joined (or has left), from the latest `room_list`. */
	let unjoined = $derived((session.snapshot.directory ?? []).filter((listing) => !listing.joined));
	/** Threads of the active room this user hasn't joined, once `room_list` has listed them. */
	// From the same source as the room's thread cards: a held view's listing while it shows, so they change over together.
	let otherThreads = $derived(canBrowse ? (session.threadSource(session.activeRoomId).directory ?? []).filter((listing) => !listing.joined) : []);

	/** Changes whenever a room or thread is joined or left; `roomsKey` only for a top-level room. */
	let joinedKey = $derived(session.rooms.filter((room) => room.joined).map((room) => room.id).join('\u0000'));
	let roomsKey = $derived([...rooms, ...privateRooms].filter((room) => room.joined).map((room) => room.id).join('\u0000'));
	/**
	 * How long a listing made in the background is reused, a client choice: switching between rooms shouldn't list
	 * again each time, and any server may rate-limit `room_list`. Joining or leaving lists afresh (the client drops what it changed), and so does opening Other Rooms.
	 */
	const BACKGROUND_LISTING_MS = 60_000;

	// Other Rooms and Other Threads show only when there is something to join, so list both in the background:
	// the rooms whenever the rooms you've joined change, and the active room's threads whenever it or what you've
	// joined changes. Threads you haven't joined deliver nothing live (§3.4): this listing is also what brings their
	// cards up to date. One refused for a while lists again once the wait is over.
	// Listed on each connection (`ready`), not `canBrowse`, which holds through a quiet reconnect: a new connection
	// has none of the last one's listings.
	$effect(() => {
		void roomsKey;
		if (!canBrowse || !session.ready) return;
		return untrack(() => listInBackground(() => client.listRooms(undefined, BACKGROUND_LISTING_MS)));
	});
	$effect(() => {
		const roomId = session.activeRoomId;
		void joinedKey;
		if (!canBrowse || !session.ready || !roomId) return;
		return untrack(() => listInBackground(() => client.listRooms(roomId, BACKGROUND_LISTING_MS)));
	});

	/**
	 * The rooms whose threads are folded to those with news, as under a room that isn't open: picking the open room
	 * again while reading it folds them, and once more (or its …) unfolds them. They stay folded as you come and go,
	 * kept on this device for the account.
	 */
	let threadsFolded = $state<string[]>([]);
	$effect(() => {
		threadsFolded = account === undefined ? [] : loadThreadFolds(account);
	});
	function foldThreads(roomId: string, shut: boolean): void {
		const others = threadsFolded.filter((id) => id !== roomId);
		threadsFolded = shut ? [...others, roomId] : others;
		if (account !== undefined) saveThreadFolds(account, threadsFolded);
	}
	function pickRoom(room: RoomSnapshot, current: boolean): void {
		if (!current) return onroom(room);
		foldThreads(room.id, !threadsFolded.includes(room.id));
		// One pane at a time on a phone: there the list stays, to see the fold, and its › goes back to the room.
		if (innerWidth >= NARROW_MAX) onroom(room);
	}

	function list(parentRoomId?: string): void {
		listError = '';
		client.listRooms(parentRoomId).catch((cause: unknown) => (listError = cause instanceof Error ? cause.message : 'Unable to list rooms'));
	}

</script>

<!-- A room's row, with its threads under it while it's open (and only those with news while it isn't, or is folded); a private room's with its faces. -->
{#snippet roomRow(room: RoomSnapshot, faces?: Face[])}
	{@const active = room.id === session.activeRoomId}
	{@const current = active && !activeThread}
	{@const isFolded = threadsFolded.includes(room.id)}
	<!-- What's new in the room itself (its threads show their own): none while you're reading it. The Private list says it's private: no lock there. -->
	<RoomItem
		room={room.id} name={room.title} title={room.untitled ? room.id : undefined} private={faces ? false : room.private} {faces} muted={room.mutedUntil !== undefined} active={current}
		unread={current ? 0 : (unread[room.id] ?? 0)} mentions={current ? 0 : (mentions[room.id] ?? 0)} unreadTestid="room-unread" loading={room.recovering && !session.reconnectQuiet} keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
		onselect={() => pickRoom(room, current)} onnewthread={active && canCreateRoom ? () => onnewthread(room) : undefined} newThreadTestid="create-thread"
		onexpand={active && isFolded ? () => foldThreads(room.id, false) : undefined} expandTestid="expand-threads"
	/>
	{#if reordering}
		<!-- While a room is carried, every room's threads are folded away. -->
	{:else if active && !isFolded}
		<ThreadList roomId={room.id} roomTitle={room.title} {threads} others={otherThreads} foldInactive {activeThread} {mentions} {unread} muted={session.snapshot.roomMutes} canJoin={canJoinThreads} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread} />
	{:else}
		<!-- Under a room that isn't open (or is folded, when its row has a … that unfolds it), only its joined threads with news, so activity there isn't missed; and the one open in it, which stays while you read it. -->
		{@const news = threadsWithNews(threadsOf.get(room.id) ?? [], room.id, unread, mentions)}
		{@const kept = active ? threads.filter((entry) => entry.id === activeThread || news.some((other) => other.id === entry.id)) : news}
		{#if kept.length > 0}
			<ThreadList roomId={room.id} roomTitle={room.title} threads={kept} others={[]} activeThread={active ? activeThread : undefined} {mentions} {unread} muted={session.snapshot.roomMutes} canJoin={canJoinThreads} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread} />
		{/if}
	{/if}
{/snippet}

<!-- A section's rooms, in an order that can be changed: dragged by their rows, or moved with Alt+↑/↓. -->
{#snippet roomList(section: Section, list: RoomSnapshot[], withFaces: boolean)}
	{@const items = carried[section] ?? steady(section, list)}
	<!-- The rows inside are the controls; the list takes their keys to reorder them. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="ap-roomlist" use:reorderable={section} onkeydown={(event) => reorderKey(event, list)}>
		{#each items as listedRoom (listedRoom.id)}
			<!-- Each row takes its room as it is now on its own, so a message redraws (and marks to check) only its room's row. -->
			{@const room = session.room(listedRoom.id) ?? listedRoom}
			<!-- The others make way for a carried room; a fold or a new room isn't animated. -->
			<div class="ap-roomblock" animate:flip={{ duration: reordering ? FLIP_MS : 0 }}>{@render roomRow(room, withFaces ? roomFaces(room, session.you) : undefined)}</div>
		{/each}
	</div>
{/snippet}

<aside class="ap-shell-side" aria-label="Rooms">
	<SidebarHead name={serverLook?.title ?? backendLabel} address={serverAddress} avatar={directory.avatarGate.src(serverLook?.avatar)} onopen={() => serverHead && serverPane.toggle({ anchor: serverHead })} expanded={serverHead !== undefined && serverPane.anchor === serverHead} bind:button={serverHead} {returnTo} {onreturn} />
	<div class="ap-shell-sidebody">
		{#if drawRooms}
			<SidebarSection title="Rooms" folded={folds.has('rooms')} onfold={(shut) => fold('rooms', shut)} onadd={canCreateRoom ? () => (createOpen = true) : undefined} addLabel="Create room" loading={rooms.length === 0 && privateRooms.length === 0 && session.starting} bodyTestid="room-list">
				{#if rooms.length === 0}
					<p class="ap-sect-note">{session.snapshot.status === 'connected' ? 'No rooms yet.' : 'Waiting for rooms…'}</p>
				{:else}
					{@render roomList('rooms', shown(rooms, 'rooms'), false)}
				{/if}
			</SidebarSection>
			<!-- Shown with private rooms in it, or empty, for its +, where you could start one. -->
			{#if privateRooms.length > 0 || onnewprivate}
				<SidebarSection title="Private" folded={folds.has('private')} onfold={(shut) => fold('private', shut)} onadd={onnewprivate} addLabel="New private conversation" bodyTestid="private-list">
					{@render roomList('private', shown(privateRooms, 'private'), true)}
				</SidebarSection>
			{/if}
			{#if canBrowse && unjoined.length > 0}
				<!-- Servers may list only the most active rooms (§4.2.1), so this never claims to be all of them. -->
				<SidebarSection title="Other Rooms" folded={folds.has('otherRooms')} onfold={(shut) => { fold('otherRooms', shut); if (!shut) list(); }} toggleTestid="browse-rooms" bodyTestid="room-directory">
					{#each shown(unjoined, 'otherRooms') as listing (listing.id)}
						<!-- A server may list only the most active members of a large room, with the total (§4.2.1). -->
						{@const members = listing.memberCount ?? listing.members.length}
						{@const count = members > 0 ? `${members} ${members === 1 ? 'member' : 'members'}` : ''}
						<!-- Picking one opens it to read without joining (joining shows everyone in it), and it shows as open as a joined room does; the header's Join, or posting there, joins it. -->
						<RoomItem room={listing.id} name={listing.title} topic={count || undefined} listed active={listing.id === session.activeRoomId && !activeThread} onselect={() => onopenroom(listing.id)} />
						<!-- The one open to read without joining lists its threads under it, to explore them without joining either. -->
						{#if listing.id === session.activeRoomId}
							<ThreadList
								roomId={listing.id} roomTitle={listing.title} {threads} others={otherThreads} foldInactive roomUnjoined {activeThread}
								{mentions} {unread} muted={session.snapshot.roomMutes} canJoin={canJoinThreads} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread}
							/>
						{:else}
							<!-- Another lists its threads you've joined with news, as a joined room's row does: once opened it holds them, so they're no longer listed on their own. -->
							{@const news = threadsWithNews(threadsOf.get(listing.id) ?? [], listing.id, unread, mentions)}
							{#if news.length > 0}
								<ThreadList roomId={listing.id} roomTitle={listing.title} threads={news} others={[]} {mentions} {unread} muted={session.snapshot.roomMutes} canJoin={canJoinThreads} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread} />
							{/if}
						{/if}
					{/each}
					{#if listError && !folds.has('otherRooms')}<p class="ap-sect-note ap-tone-danger" role="alert">{listError}</p>{/if}
				</SidebarSection>
			{/if}
		{/if}
	</div>
	<p class="ap-sr" role="status" aria-atomic="true">{moved}</p>
	<ProfileBar {client} {session} {backendLabel} bind:displayName {passkeyUnavailable} {notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes} {onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume} {onsignout} {keptHistory} {onsignin} />
</aside>

{#if createOpen && newRoomDialog.component}{@const NewRoomDialog = newRoomDialog.component}<NewRoomDialog {client} enabled={canCreateRoom} oncreated={oncreateroom} onclose={() => (createOpen = false)} />{/if}

