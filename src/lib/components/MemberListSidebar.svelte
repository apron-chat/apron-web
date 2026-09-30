<script lang="ts">
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { userIdToAdd } from '$lib/ui/members';
	import Avatar from './Avatar.svelte';
	import RoleBadges from './RoleBadges.svelte';

	interface Props {
		client: ChatClient | undefined;
		session: SessionView;
		/** The open pane's room: the thread when one is open, which has its own members. */
		room: RoomSnapshot | undefined;
		open: boolean;
		/**
		 * Offer adding and removing other members (`room_join` and `room_leave`
		 * with `user_id`, §4.3.2): capability `rooms`, signed in with writes allowed, and
		 * the room joined. Who may is server policy; a server that doesn't support
		 * it at all answers `unsupported`, and the offer goes.
		 */
		canChange: boolean;
	}
	let { client, session, room, open, canChange }: Props = $props();

	let members = $derived([...(room?.members ?? [])].sort((a, b) =>
		directory.name(a).localeCompare(directory.name(b), undefined, { sensitivity: 'base' }) || a.user_id.localeCompare(b.user_id)
	));
	/** A large room's listing may hold only its most recently active members, with the total (§4.3.1). */
	let total = $derived(room?.members === undefined ? undefined : Math.max(room.memberCount ?? 0, room.members.length));
	let truncated = $derived(total !== undefined && room?.members !== undefined && total > room.members.length);
	let changing = $derived(canChange && !session.snapshot.memberChangesUnsupported && Boolean(client) && Boolean(room?.joined));
	/** People this client knows of who aren't members yet, suggested by `user_id` when adding someone. */
	let candidates = $derived.by(() => {
		const current = new Set((room?.members ?? []).map((member) => member.user_id));
		return Object.values(session.snapshot.users).filter((user) => !current.has(user.user_id) && !user.user_id.startsWith('~'));
	});
	let adding = $state('');
	let busy = $state(false);
	let note = $state<{ text: string; error: boolean } | undefined>();

	$effect(() => {
		void room?.id;
		note = undefined;
		adding = '';
	});

	async function add(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const userId = userIdToAdd(adding);
		if (!userId) {
			note = { text: 'Enter the person’s @user_id: names aren’t unique.', error: true };
			return;
		}
		if (!client || !room || busy) return;
		busy = true;
		note = undefined;
		try {
			await client.joinRoom(room.id, userId).promise;
			note = { text: `Added ${directory.name({ user_id: userId })}.`, error: false };
			adding = '';
		} catch (cause) {
			note = { text: cause instanceof Error ? cause.message : 'Unable to add them', error: true };
		} finally {
			busy = false;
		}
	}

	async function remove(userId: string): Promise<void> {
		if (!client || !room || busy) return;
		const name = directory.name({ user_id: userId });
		if (!confirm(`Remove ${name} from ${room.title}?`)) return;
		busy = true;
		note = undefined;
		try {
			await client.leaveRoom(room.id, userId).promise;
		} catch (cause) {
			note = { text: cause instanceof Error ? cause.message : `Unable to remove ${name}`, error: true };
		} finally {
			busy = false;
		}
	}
</script>

<aside class="member-list" class:open aria-label="Room member list">
	<div class="member-list-head">
		<span role="heading" aria-level="2">Member list</span>
		{#if total !== undefined}<span class="member-list-count" data-testid="member-count">{total}</span>{/if}
	</div>
	<div class="member-list-body" data-testid="room-member-list">
		{#if !room}
			<p class="muted">Select a room to see its members.</p>
		{:else if room.members === undefined}
			<p class="muted">{session.canManageRooms ? 'Loading members…' : 'Members are unavailable on this server.'}</p>
		{:else}
			{#if changing}
				<form class="add" onsubmit={add} aria-label="Add a member">
					<input class="ap-field" list="member-candidates" placeholder="Add by @user_id" aria-label="User to add" bind:value={adding} disabled={busy} autocomplete="off" spellcheck="false" />
					<datalist id="member-candidates">
						{#each candidates as user (user.user_id)}<option value={user.user_id}>{directory.name(user)} (@{user.user_id})</option>{/each}
					</datalist>
					<button class="ap-btn ap-btn-sm" type="submit" disabled={busy || !adding.trim()}>Add</button>
				</form>
			{/if}
			{#if note}<p class="muted" class:err={note.error} role={note.error ? 'alert' : 'status'}>{note.text}</p>{/if}
			{#if session.snapshot.memberChangesUnsupported && canChange}<p class="muted">This server doesn’t let members add or remove others.</p>{/if}
			{#if members.length === 0}
				<p class="muted">No members listed.</p>
			{:else}
				{#if truncated}<p class="muted" data-testid="member-list-truncated">Showing {members.length} of {total}: the most recently active</p>{/if}
				<ul class="members" aria-label={`Members of ${room.title}`}>
					{#each members as person (person.user_id)}
						{@const name = directory.name(person)}
						{@const me = directory.isMe(person.user_id)}
						<li class="member" data-user={person.user_id}>
							<Avatar {name} id={person.user_id} src={directory.avatar(person)} size="sm" />
							<span class="member-name" title={person.user_id}>
								{name}{#if directory.sharesName(person)}<small>@{person.user_id}</small>{/if}{#if me}<small>(you)</small>{/if}
							</span>
							<RoleBadges user={person} />
							{#if changing && !me}
								<button class="ap-iconbtn remove" type="button" aria-label={`Remove ${name}`} title="Remove from room" disabled={busy} onclick={() => remove(person.user_id)}><UserMinus size={14} aria-hidden="true" /></button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</aside>

<style>
	.member-list { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-000); border-left: 1px solid var(--line); }
	.member-list:not(.open) { display: none; }
	.member-list-head { display: flex; align-items: center; gap: var(--space-2); height: var(--header-h); flex: none; padding: 0 var(--space-4); border-bottom: 1px solid var(--line); color: var(--ink); font-size: 15px; line-height: 20px; font-weight: 600; }
	.member-list-count { color: var(--ink-muted); font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
	.member-list-body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-3) var(--space-2); }
	.muted { margin: 0; padding: var(--space-1) var(--space-3); color: var(--ink-muted); font-size: 13px; line-height: 18px; }
	.err { color: var(--danger); }
	.add { display: flex; gap: var(--space-2); padding: 0 var(--space-1) var(--space-2); }
	.add .ap-field { flex: 1; min-width: 0; height: 28px; font-size: 13px; }
	.members { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
	.member { display: flex; align-items: center; gap: var(--space-2); min-height: 32px; padding: 2px var(--space-1); color: var(--ink); font-size: 13px; line-height: 18px; }
	/* Role badges follow the name, as beside a message's sender; the remove button takes the far right. */
	.member-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.member :global(.ap-roles) { flex: none; flex-wrap: nowrap; }
	.member-name small { margin-left: 4px; color: var(--ink-muted); font-size: 11px; }
	/* Remove shows on hover or focus, always on touch screens. */
	.remove { flex: none; width: 24px; height: 24px; margin-left: auto; opacity: 0; }
	.member:hover .remove, .member:focus-within .remove { opacity: 1; }
	@media (hover: none) { .remove { opacity: 1; } }
	@media (max-width: 959px) {
		.member-list.open { display: flex; position: absolute; z-index: 6; top: var(--header-h); right: 0; bottom: 0; width: min(var(--member-list-w, 280px), calc(100vw - 24px)); box-shadow: var(--shadow-float); }
	}
</style>
