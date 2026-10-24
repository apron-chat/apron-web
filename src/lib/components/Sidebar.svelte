<script lang="ts">
	import { newRoomDialog } from './lazy';
	import { untrack } from 'svelte';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import type { SessionView } from '$lib/ui/session.svelte';
	import type { NotificationPermissionState, NotificationTestResult } from '$lib/ui/notifications';
	import type { WebPushPreference } from '$lib/ui/web-push';
	import type { PausedUntil } from '$lib/ui/pause';
	import { sidebarRooms, threadsWithNews, type ThreadEntry } from '$lib/ui/timeline';
	import { listInBackground } from '$lib/ui/background-listing';
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
		onsignout: SignOutHandler;
		/** Opens the connect screen to sign in with a passkey, carrying a handle typed in the profile. */
		onsignin: (name?: string, scheme?: 'webauthn' | 'email' | 'external') => void;
	}
	let { client, session, backendLabel, threads, activeThread, mentions, unread, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, onconnect, returnTo, onreturn, onroom, onthread, onopenthread, onjoin, onleavethread, oncreateroom, onnewthread, onsignout, onsignin }: Props = $props();
	/** Threads are listed under their parent, not as rooms of their own. */
	let rooms = $derived(sidebarRooms(session.rooms));
	let canBrowse = $derived(session.canManageRooms && session.ready);
	/** What picking a listed room does: join it, or open it without joining where guests only read. */
	let action = $derived(session.readOnly ? 'Open' : 'Join');
	let browseOpen = $state(false);
	let listError = $state('');
	let createOpen = $state(false);
	let canCreateRoom = $derived(session.canManageRooms && session.ready && !session.readOnly);
	/** Visible rooms this user hasn't joined (or has left), from the latest `room_list`. */
	let unjoined = $derived((session.snapshot.directory ?? []).filter((listing) => !listing.joined));
	/** Threads of the active room this user hasn't joined, once `room_list` has listed them. */
	// From the same source as the room's thread cards: a held view's listing while it shows, so they change over together.
	let otherThreads = $derived(canBrowse ? (session.threadSource(session.activeRoomId).directory ?? []).filter((listing) => !listing.joined) : []);

	/** Changes whenever a room or thread is joined or left; `roomsKey` only for a top-level room. */
	let joinedKey = $derived(session.rooms.filter((room) => room.joined).map((room) => room.id).join('\u0000'));
	let roomsKey = $derived(rooms.filter((room) => room.joined).map((room) => room.id).join('\u0000'));
	/**
	 * How long a listing made in the background is reused, a client choice: switching between rooms shouldn't list
	 * again each time, and any server may rate-limit `room_list`. Joining or leaving lists afresh (the client drops what it changed), and so does opening Browse.
	 */
	const BACKGROUND_LISTING_MS = 60_000;

	// Browse rooms and Other threads show only when there is something to join, so list both in the background:
	// the rooms whenever the rooms you've joined change, and the active room's threads whenever it or what you've
	// joined changes. Threads you haven't joined deliver nothing live (§3.4): this listing is also what brings their
	// cards up to date. One refused for a while lists again once the wait is over.
	$effect(() => {
		void roomsKey;
		if (!canBrowse) return;
		return untrack(() => listInBackground(() => client.listRooms(undefined, BACKGROUND_LISTING_MS)));
	});
	$effect(() => {
		const roomId = session.activeRoomId;
		void joinedKey;
		if (!canBrowse || !roomId) return;
		return untrack(() => listInBackground(() => client.listRooms(roomId, BACKGROUND_LISTING_MS)));
	});

	function list(parentRoomId?: string): void {
		listError = '';
		client.listRooms(parentRoomId).catch((cause: unknown) => (listError = cause instanceof Error ? cause.message : 'Unable to list rooms'));
	}

</script>

<aside class="ap-shell-side" aria-label="Rooms">
	<SidebarHead name={backendLabel} {onconnect} {returnTo} {onreturn} />
	<div class="ap-shell-sidebody">
		<SidebarSection title="Rooms" collapsible={false} onadd={canCreateRoom ? () => (createOpen = true) : undefined} addLabel="Create room" loading={rooms.length === 0 && session.starting} bodyTestid="room-list">
			{#if rooms.length === 0}
				<p class="ap-sect-note">{session.snapshot.status === 'connected' ? 'No rooms yet.' : 'Waiting for rooms…'}</p>
			{:else}
				{#each rooms as room (room.id)}
					{@const active = room.id === session.activeRoomId}
					{@const current = active && !activeThread}
					<!-- What's new in the room itself (its threads show their own): none while you're reading it. -->
					<RoomItem
						room={room.id} name={room.title} title={room.untitled ? room.id : undefined} private={room.private} active={current}
						unread={current ? 0 : (unread[room.id] ?? 0)} mentions={current ? 0 : (mentions[room.id] ?? 0)} unreadTestid="room-unread" loading={room.recovering}
						onselect={() => onroom(room)} onnewthread={active && canCreateRoom ? () => onnewthread(room) : undefined} newThreadTestid="create-thread"
					/>
					{#if active}
						<ThreadList roomId={room.id} roomTitle={room.title} {threads} others={otherThreads} {activeThread} {mentions} {unread} canJoin={!session.readOnly && session.canManageRooms} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread} />
					{:else}
						<!-- Under a room that isn't open, only its joined threads with news, so activity there isn't missed. -->
						{@const news = threadsWithNews(session.rooms, room.id, unread, mentions)}
						{#if news.length > 0}
							<ThreadList roomId={room.id} roomTitle={room.title} threads={news} others={[]} {mentions} {unread} canJoin={!session.readOnly && session.canManageRooms} {onthread} onopen={onopenthread} {onjoin} onleave={onleavethread} />
						{/if}
					{/if}
				{/each}
			{/if}
		</SidebarSection>
		{#if canBrowse && unjoined.length > 0}
			<SidebarSection title="Browse rooms" bind:open={browseOpen} ontoggle={(open) => { if (open) list(); }} toggleTestid="browse-rooms" bodyTestid="room-directory">
				<!-- Servers may list only the most active rooms (§4.2.1), so this never claims to be all of them. -->
				<p class="ap-sect-note">Most active rooms</p>
				{#each unjoined as listing (listing.id)}
					<!-- A server may list only the most active members of a large room, with the total (§4.2.1). -->
					{@const members = listing.memberCount ?? listing.members.length}
					<RoomItem room={listing.id} name={listing.title} topic={`${members > 0 ? `${members} ${members === 1 ? 'member' : 'members'} · ` : ''}${action}`} listed onselect={() => onjoin(listing.id)} />
				{/each}
				{#if listError}<p class="ap-sect-note ap-tone-danger" role="alert">{listError}</p>{/if}
			</SidebarSection>
		{/if}
	</div>
	<ProfileBar {client} {session} {backendLabel} bind:displayName {passkeyUnavailable} {notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes} {onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume} {onsignout} {onsignin} />
</aside>

{#if createOpen && newRoomDialog.component}{@const NewRoomDialog = newRoomDialog.component}<NewRoomDialog {client} enabled={canCreateRoom} oncreated={oncreateroom} onclose={() => (createOpen = false)} />{/if}

