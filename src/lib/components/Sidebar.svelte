<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import type { SessionView } from '$lib/ui/session.svelte';
	import type { NotificationPermissionState, NotificationTestResult } from '$lib/ui/notifications';
	import type { WebPushPreference } from '$lib/ui/web-push';
	import type { PausedUntil } from '$lib/ui/pause';
	import { sidebarRooms, threadsWithNews, type ThreadEntry } from '$lib/ui/timeline';
	import type { SignOutHandler } from '$lib/ui/sign-in';
	import NewRoomDialog from './NewRoomDialog.svelte';
	import ProfileBar from './ProfileBar.svelte';
	import ThreadList from './ThreadList.svelte';
	import UnreadCount from '$lib/design/components/UnreadCount.svelte';

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
		onsignin: (name?: string, scheme?: 'webauthn' | 'email') => void;
	}
	let { client, session, backendLabel, threads, activeThread, mentions, unread, displayName = $bindable(), passkeyUnavailable, notificationsEnabled, notificationsSupported, notificationPermission, notifyScopes, onnotifications, onnotifyscopes, ontestnotifications, webPush, onwebpush, oninstallapp, pause, onpause, onresume, onconnect, onroom, onthread, onopenthread, onjoin, onleavethread, oncreateroom, onnewthread, onsignout, onsignin }: Props = $props();
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

	/** Changes whenever a room or thread is joined or left. */
	let joinedKey = $derived(session.rooms.filter((room) => room.joined).map((room) => room.id).join('\u0000'));

	// Browse rooms and Other threads show only when there is something to join, so list both in the background
	// (the rooms, and the active room's threads) whenever the active room or what you've joined changes. Threads
	// you haven't joined deliver nothing live (§3.4): this listing is also what brings their cards up to date.
	$effect(() => {
		const roomId = session.activeRoomId;
		void joinedKey;
		if (!canBrowse) return;
		untrack(() => {
			client.listRooms().catch(() => {});
			if (roomId) client.listRooms(roomId).catch(() => {});
		});
	});

	function list(parentRoomId?: string): void {
		listError = '';
		client.listRooms(parentRoomId).catch((cause: unknown) => (listError = cause instanceof Error ? cause.message : 'Unable to list rooms'));
	}

	function toggleBrowse(): void {
		browseOpen = !browseOpen;
		if (browseOpen) list();
	}

</script>

<aside class="ap-shell-side" aria-label="Rooms">
	<div class="ap-shell-sidehead">
		<span class="backend">{backendLabel}</span>
		<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label="Connection settings" onclick={onconnect}>Connect</button>
	</div>
	<div class="ap-shell-sidebody">
		<section class="ap-sect">
			<div class="ap-sect-head">
				<span class="ap-sect-toggle" role="heading" aria-level="2">Rooms</span>
				{#if canCreateRoom}
					<button class="ap-btn ap-btn-ghost ap-btn-sm create-room-trigger" type="button" aria-label="Create room" title="Create room" onclick={() => (createOpen = true)}><Plus size={18} aria-hidden="true" /></button>
				{/if}
			</div>
			<div class="ap-sect-body" data-testid="room-list">
				{#if rooms.length === 0 && session.starting}
					<div class="placeholder" aria-hidden="true"><span class="ap-skel" style:width="70%"></span><span class="ap-skel" style:width="52%"></span><span class="ap-skel" style:width="61%"></span></div>
				{:else if rooms.length === 0}
					<p class="muted">{session.snapshot.status === 'connected' ? 'No rooms yet.' : 'Waiting for rooms…'}</p>
				{:else}
					{#each rooms as room (room.id)}
						{@const active = room.id === session.activeRoomId}
						{@const current = active && !activeThread}
						<!-- What's new in the room itself (its threads show their own): none while you're reading it. -->
						{@const roomUnread = current ? 0 : (unread[room.id] ?? 0)}
						{@const roomMentions = current ? 0 : (mentions[room.id] ?? 0)}
						<div class="room-row">
							<button class="ap-room" class:ap-room-active={current} class:ap-room-unread={roomUnread > 0 || roomMentions > 0} class:can-start={active && canCreateRoom} type="button" data-room={room.id} aria-current={current ? 'page' : undefined} onclick={() => onroom(room)}>
								<span class="ap-room-text">
									<span class="ap-room-name">{room.title}{#if room.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>
								</span>
								<UnreadCount unread={roomUnread} mentions={roomMentions} testid="room-unread" />
								{#if room.recovering}<span class="room-meta" aria-label="Loading history">…</span>{/if}
							</button>
							{#if active && canCreateRoom}
								<button class="ap-iconbtn new-thread" type="button" data-testid="create-thread" aria-label={`New thread in ${room.title}`} title="New thread" onclick={() => onnewthread(room)}><Plus size={16} aria-hidden="true" /></button>
							{/if}
						</div>
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
			</div>
		</section>
		{#if canBrowse && unjoined.length > 0}
			<section class="ap-sect" class:ap-sect-closed={!browseOpen}>
				<div class="ap-sect-head">
					<button class="ap-sect-toggle" type="button" aria-expanded={browseOpen} data-testid="browse-rooms" onclick={toggleBrowse}><span class="ap-sect-caret" aria-hidden="true">▾</span>Browse rooms</button>
				</div>
				{#if browseOpen}
					<div class="ap-sect-body" data-testid="room-directory">
						<!-- Servers may list only the most active rooms (§4.3.1), so this never claims to be all of them. -->
						<p class="muted">Most active rooms</p>
						{#each unjoined as listing (listing.id)}
							<!-- A server may list only the most active members of a large room, with the total (§4.3.1). -->
							{@const members = listing.memberCount ?? listing.members.length}
							<button class="ap-room" type="button" data-join={listing.id} onclick={() => onjoin(listing.id)}>
								<span class="ap-room-text">
									<span class="ap-room-name">{listing.title}</span>
									<span class="ap-room-topic">{#if members > 0}{members} {members === 1 ? 'member' : 'members'} · {/if}{action}</span>
								</span>
							</button>
						{/each}
						{#if listError}<p class="muted" role="alert">{listError}</p>{/if}
					</div>
				{/if}
			</section>
		{/if}
	</div>
	<ProfileBar {client} {session} {backendLabel} bind:displayName {passkeyUnavailable} {notificationsEnabled} {notificationsSupported} {notificationPermission} {notifyScopes} {onnotifications} {onnotifyscopes} {ontestnotifications} {webPush} {onwebpush} {oninstallapp} {pause} {onpause} {onresume} {onsignout} {onsignin} />
</aside>

{#if createOpen}<NewRoomDialog {client} enabled={canCreateRoom} oncreated={oncreateroom} onclose={() => (createOpen = false)} />{/if}

<style>
	.ap-shell-side { overflow: hidden; }
	.ap-shell-sidehead { gap: var(--space-2); }
	.create-room-trigger { width: 28px; padding: 0; justify-content: center; }
	.backend { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.placeholder { display: grid; gap: var(--space-3); padding: var(--space-2) var(--space-3); }
	.placeholder .ap-skel { height: 12px; }
	.muted { margin: 0; padding: var(--space-1) var(--space-3); color: var(--ink-muted); font-size: var(--text-ui); line-height: 18px; }
	.room-meta { flex: none; font-size: var(--text-sm); line-height: 16px; color: var(--ink-muted); font-variant-numeric: tabular-nums; }
	.room-row { position: relative; }
	.can-start { padding-right: 40px; }
	.new-thread { position: absolute; top: 50%; right: var(--space-1); transform: translateY(-50%); }
	@media (max-width: 719px) {
		.ap-shell-side { border-right: 0; }
	}
</style>
