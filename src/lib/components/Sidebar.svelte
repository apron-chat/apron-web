<script lang="ts">
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
	import { dndzone, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
	import { RoomOrder } from '$lib/ui/room-order.svelte';
	import type { SignOutHandler } from '$lib/ui/sign-in';
	import ProfileBar from './ProfileBar.svelte';
	import ThreadList from './ThreadList.svelte';
	import RoomItem from '$lib/design/components/RoomItem.svelte';
	import SidebarHead from '$lib/design/components/SidebarHead.svelte';
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
		/** The connect screen, from the profile editor's Connect to a server… button. */
		onconnect: () => void;
		/** The room or thread the phone's rooms list opened over, and the › back to it. */
		returnTo?: string;
		onreturn?: () => void;
		onroom: (room: RoomSnapshot) => void;
		onthread: (thread: string) => void;
		/** Reads a thread of the active room that you haven't joined, without joining it. */
		onopenthread: (thread: string) => void;
		/** Join a visible room or thread from `room_list` (capability `rooms`); it opens once its `room_update` arrives. */
		onjoin: (roomId: string) => void;
		/** Leave a thread of the active room (capability `rooms`). */
		onleavethread: (thread: string) => void;
		/** A room created here, asked for as private or not; it opens once its `room_update` arrives. */
		oncreateroom: (roomId: string, options: { private: boolean }) => void;
		/** The + on the active room's row: start a thread in it, named in the page's NewThreadDialog. */
		onnewthread: (room: RoomSnapshot) => void;
		/** The + beside Private, for a signed-in account: start a private conversation, in the page's NewPrivateDialog. */
		onnewprivate?: () => void;
		onsignout: SignOutHandler;
		/** Opens the connect screen to sign in with a passkey, carrying a handle typed in the profile. */
		onsignin: (name?: string, scheme?: 'webauthn' | 'email' | 'external') => void;
	}
	let { client, session, backendLabel, serverLook, serverAddress, account, order = new RoomOrder(), threads, activeThread, mentions, unread, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, onconnect, returnTo, onreturn, onroom, onthread, onopenthread, onjoin, onleavethread, oncreateroom, onnewthread, onnewprivate, onsignout, onsignin }: Props = $props();
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
	 * Dragging a room to another place in its section (svelte-dnd-action): by its row, with a mouse once it moves, or
	 * held on a touch screen for `HOLD_MS`, when it lifts; a shorter touch scrolls or picks it. While one is carried every
	 * room's threads fold away, so the list is just its rooms, and come back as they were once it's dropped.
	 */
	const HOLD_MS = 350;
	/** How long the other rooms take to make way, none for reduced motion. */
	const FLIP_MS = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150;
	type Section = 'rooms' | 'private';
	/** Each section's rooms while one is carried in it, as they'd land; none between drags. */
	let carried = $state<Partial<Record<Section, RoomSnapshot[]>>>({});
	let reordering = $derived(Object.keys(carried).length > 0);
	function consider(section: Section, event: CustomEvent<DndEvent<RoomSnapshot>>): void {
		carried = { ...carried, [section]: event.detail.items };
		// The library holds the list at its height as the drag starts, before the threads fold away: let it close up.
		if (event.detail.info.trigger === TRIGGERS.DRAG_STARTED) (event.currentTarget as HTMLElement).style.minHeight = '';
	}
	/** Dropped: next to the room shown before it in its section (or after it, at the top), so the ones a folded section hides keep their places. */
	function finalize(section: Section, event: CustomEvent<DndEvent<RoomSnapshot>>): void {
		const { items, info } = event.detail;
		const { [section]: _done, ...rest } = carried;
		carried = rest;
		if (info.trigger !== TRIGGERS.DROPPED_INTO_ZONE) return;
		const ids = items.map((room) => room.id);
		const at = ids.indexOf(info.id);
		if (at > 0) order.move(info.id, ids[at - 1], 'after');
		else if (ids.length > 1) order.move(info.id, ids[1], 'before');
	}
	/** The room as it's carried: its threads left behind (the others' fold away too), raised off the list. */
	function lift(element: HTMLElement | undefined): void {
		if (!element) return;
		element.classList.add('ap-roomblock-lifted');
		for (const threads of element.querySelectorAll('.ap-threads')) threads.remove();
	}
	/** How far the mouse moves with the button down before a room lifts: further than a click drifts (the library's is 3px). */
	const MOUSE_SLOP = 8;
	/**
	 * Hands svelte-dnd-action, listening on the room's block, the presses on the room's own row, and only those: its
	 * threads, its + and its … keep their presses. The library starts no drag from a nested button (it takes one for a
	 * form control), and the row is one, so a press on it reaches the library as a press on the block: a touch at once
	 * (the library holds it for `HOLD_MS` before it lifts), a mouse press once it has moved `MOUSE_SLOP`, so a click
	 * that drifts a little stays a click. Native listeners: Svelte delegates `onmousedown` and `ontouchstart` to the
	 * root, past the block.
	 */
	function grip(node: HTMLElement): () => void {
		const block = node.parentElement!;
		let release: (() => void) | undefined;
		const press = (event: Event) => {
			const onRow = event.target instanceof Element && event.target.closest('button[data-room]');
			if (!onRow || event.type !== 'touchstart') event.stopPropagation();
			if (!onRow) return;
			if (event.type === 'touchstart') return void Object.defineProperty(event, 'target', { value: block });
			const { button, clientX: x, clientY: y } = event as MouseEvent;
			if (button !== 0) return;
			const move = (e: MouseEvent) => {
				if (Math.hypot(e.clientX - x, e.clientY - y) < MOUSE_SLOP) return;
				release?.();
				block.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
				// The library now waits for the pointer to move from where the press began, which it already has.
				dispatchEvent(new MouseEvent('mousemove', { clientX: e.clientX, clientY: e.clientY }));
			};
			release = () => {
				removeEventListener('mousemove', move);
				removeEventListener('mouseup', release!);
				release = undefined;
			};
			addEventListener('mousemove', move);
			addEventListener('mouseup', release);
		};
		node.addEventListener('mousedown', press);
		node.addEventListener('touchstart', press, { passive: true });
		return () => {
			release?.();
			node.removeEventListener('mousedown', press);
			node.removeEventListener('touchstart', press);
		};
	}
	/**
	 * A tap that doesn't become a drag gets a click from the library as well as the browser's own (with the hold before a
	 * touch drag, the browser's always comes too): the library's, a plain Event, is dropped, so a tap picks once.
	 */
	function oneClick(node: HTMLElement): () => void {
		const click = (event: Event) => {
			if (!(event instanceof MouseEvent)) event.stopImmediatePropagation();
		};
		node.addEventListener('click', click, true);
		return () => node.removeEventListener('click', click, true);
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
	 * The sections folded to their rows with news, as picking the open room folds its threads: Rooms and Private keep the
	 * rooms with unread messages or mentions, in them or their threads, and the open one, which reading would otherwise
	 * take away; Other Rooms, whose rooms have none, keeps nothing. All open from the start, and kept as left, on this device.
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
	/** News in the room, or in a thread of it you've joined (as `threadsWithNews` counts them, without building their entries). */
	const hasNews = (room: RoomSnapshot) => newsIn(room.id) || session.rooms.some((thread) => thread.parentRoomId === room.id && thread.joined && newsIn(thread.id));
	const shown = (list: RoomSnapshot[], key: string) => (folds.has(key) ? list.filter((room) => room.id === session.activeRoomId || hasNews(room)) : list);
	let listError = $state('');
	let createOpen = $state(false);
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
		unread={current ? 0 : (unread[room.id] ?? 0)} mentions={current ? 0 : (mentions[room.id] ?? 0)} unreadTestid="room-unread" loading={room.recovering && !session.reconnectQuiet}
		onselect={() => pickRoom(room, current)} onnewthread={active && canCreateRoom ? () => onnewthread(room) : undefined} newThreadTestid="create-thread"
		onexpand={active && isFolded ? () => foldThreads(room.id, false) : undefined} expandTestid="expand-threads"
	/>
	{#if reordering}
		<!-- While a room is carried, every room's threads are folded away. -->
	{:else if active && !isFolded}
		<ThreadList roomId={room.id} roomTitle={room.title} {threads} others={otherThreads} {activeThread} {mentions} {unread} muted={session.snapshot.roomMutes} canJoin={!session.readOnly && session.canManageRooms} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread} />
	{:else}
		<!-- Under a room that isn't open (or is folded, when its row has a … that unfolds it), only its joined threads with news, so activity there isn't missed; and the one open in it, which stays while you read it. -->
		{@const news = threadsWithNews(session.rooms, room.id, unread, mentions)}
		{@const kept = active ? threads.filter((entry) => entry.id === activeThread || news.some((other) => other.id === entry.id)) : news}
		{#if kept.length > 0}
			<ThreadList roomId={room.id} roomTitle={room.title} threads={kept} others={[]} activeThread={active ? activeThread : undefined} {mentions} {unread} muted={session.snapshot.roomMutes} canJoin={!session.readOnly && session.canManageRooms} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread} />
		{/if}
	{/if}
{/snippet}

<!--
	A section's rooms, in an order that can be changed: dragged by their rows, or moved with Alt+↑/↓. The rooms are the
	controls: the library's own keyboard dragging and announcements stay off (tab indexes -1, no aria), Alt+↑/↓ standing
	in for them, and it keeps no outline on the list while a room is carried.
-->
{#snippet roomList(section: Section, list: RoomSnapshot[], withFaces: boolean)}
	{@const items = carried[section] ?? list}
	<!-- The rows inside are the controls; the list takes their keys to reorder them. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="ap-roomlist"
		use:dndzone={{ items, type: section, flipDurationMs: FLIP_MS, delayTouchStart: HOLD_MS, zoneTabIndex: -1, zoneItemTabIndex: -1, autoAriaDisabled: true, dropTargetStyle: {}, useCursorForDetection: true, transformDraggedElement: lift }}
		onconsider={(event) => consider(section, event)} onfinalize={(event) => finalize(section, event)} onkeydown={(event) => reorderKey(event, list)} {@attach oneClick}
	>
		{#each items as room (room.id)}
			<!-- The others make way for a carried room; a fold or a new room isn't animated. -->
			<div class="ap-roomblock" animate:flip={{ duration: reordering ? FLIP_MS : 0 }}>
				<div class="ap-roomgrip" {@attach grip}>{@render roomRow(room, withFaces ? roomFaces(room, session.you) : undefined)}</div>
			</div>
		{/each}
	</div>
{/snippet}

<aside class="ap-shell-side" aria-label="Rooms">
	<SidebarHead name={serverLook?.title ?? backendLabel} address={serverAddress} avatar={serverLook?.avatar} {returnTo} {onreturn} />
	<div class="ap-shell-sidebody">
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
				{#if !folds.has('otherRooms')}
					{#each unjoined as listing (listing.id)}
						<!-- A server may list only the most active members of a large room, with the total (§4.2.1). -->
						{@const members = listing.memberCount ?? listing.members.length}
						{@const count = members > 0 ? `${members} ${members === 1 ? 'member' : 'members'}` : ''}
						<!-- Picking one joins it; one that can't join (reading as a guest) opens it to read, which needs no word. -->
						<RoomItem room={listing.id} name={listing.title} topic={session.readOnly ? count || undefined : [count, 'Join'].filter(Boolean).join(' · ')} listed onselect={() => onjoin(listing.id)} />
					{/each}
					{#if listError}<p class="ap-sect-note ap-tone-danger" role="alert">{listError}</p>{/if}
				{/if}
			</SidebarSection>
		{/if}
	</div>
	<p class="ap-sr" aria-live="polite" aria-atomic="true">{moved}</p>
	<ProfileBar {client} {session} {backendLabel} bind:displayName {passkeyUnavailable} {notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes} {onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume} {onsignout} {onsignin} {onconnect} />
</aside>

{#if createOpen && newRoomDialog.component}{@const NewRoomDialog = newRoomDialog.component}<NewRoomDialog {client} enabled={canCreateRoom} oncreated={oncreateroom} onclose={() => (createOpen = false)} />{/if}

