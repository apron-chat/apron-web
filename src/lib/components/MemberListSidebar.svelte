<script lang="ts">
	import { tick } from 'svelte';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import Plus from '@lucide/svelte/icons/plus';
	import type { ChatClient, RoomSnapshot } from '$lib/protocol/client';
	import type { Identity } from '$lib/protocol/types';
	import type { SessionView } from '$lib/ui/session.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { userIdToAdd } from '$lib/ui/members';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { presence, presenceLabel } from '$lib/design/components/util';
	import { byStatus, ownStatusLabel } from '$lib/ui/user-status';
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

	/** Each member's `status` (§4.5) as kept: yours is the one you chose, as the profile bar shows it. */
	function statusOf(person: Identity): string | undefined {
		return directory.status(person);
	}
	/** By status (online, idle, dnd, unknown, offline, then none), and by name within each. */
	let members = $derived(byStatus([...(room?.members ?? [])].sort((a, b) =>
		directory.name(a).localeCompare(directory.name(b), undefined, { sensitivity: 'base' }) || a.user_id.localeCompare(b.user_id)
	), statusOf));
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
	/** The add form is open: it opens from the header's button, since most visits are to see who is here. */
	let addOpen = $state(false);
	let busy = $state(false);
	let note = $state<{ text: string; error: boolean } | undefined>();
	let addToggle = $state<HTMLButtonElement | undefined>();
	let addInput = $state<HTMLInputElement | undefined>();
	const uid = $props.id();

	$effect(() => {
		void room?.id;
		note = undefined;
		adding = '';
		addOpen = false;
	});

	async function toggleAdd(): Promise<void> {
		addOpen = !addOpen;
		if (!addOpen) return;
		note = undefined;
		await tick();
		addInput?.focus();
	}

	function closeAdd(): void {
		addOpen = false;
		adding = '';
		addToggle?.focus();
	}

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
			closeAdd();
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
		<span role="heading" aria-level="2">Members</span>
		{#if total !== undefined}<span class="member-list-count" data-testid="member-count">{total}</span>{/if}
	</div>
	<div class="member-list-body" data-testid="room-member-list">
		{#if !room && session.starting}
			<div class="placeholder" aria-hidden="true"><span class="ap-skel" style:width="62%"></span><span class="ap-skel" style:width="48%"></span></div>
		{:else if !room}
			<p class="muted">Select a room to see its members.</p>
		{:else if room.members === undefined}
			<p class="muted">{session.canManageRooms ? 'Loading members…' : 'Members are unavailable on this server.'}</p>
		{:else}
			{#if changing}
				<!-- The list's first row, laid out as a member's: its icon over the avatars, its words over the names. -->
				<button bind:this={addToggle} class="add-toggle" type="button" aria-expanded={addOpen} aria-controls={`${uid}-add`} onclick={toggleAdd}>
					<span class="add-icon" aria-hidden="true"><Plus size={12} strokeWidth={2.2} /></span>Add member
				</button>
			{/if}
			{#if changing && addOpen}
				<form class="add" id={`${uid}-add`} onsubmit={add} aria-label="Add a member">
					<label class="ap-sr" for={`${uid}-user`}>User to add</label>
					<div class="add-row">
						<input id={`${uid}-user`} bind:this={addInput} class="ap-field" list="member-candidates" placeholder="@user_id" bind:value={adding} disabled={busy} autocomplete="off" spellcheck="false" onkeydown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeAdd(); } }} />
						<button class="ap-btn ap-btn-primary ap-btn-sm" type="submit" disabled={busy || !adding.trim()}>Add</button>
					</div>
					<datalist id="member-candidates">
						{#each candidates as user (user.user_id)}<option value={user.user_id}>{directory.name(user)} (@{user.user_id})</option>{/each}
					</datalist>
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
						{@const status = statusOf(person)}
						{@const shown = presence(status)}
						{@const words = (me ? ownStatusLabel(status) : undefined) ?? presenceLabel(status)}
						<li class="member" class:offline={shown === 'offline' || shown === 'invisible'} data-user={person.user_id} data-status={shown}>
							<button class="who" type="button" data-user-id={person.user_id} aria-haspopup="dialog" title={words ? `@${person.user_id} · ${words}` : `@${person.user_id}`} onclick={(event) => openProfileFrom(event.currentTarget)}>
								<Avatar {name} id={person.user_id} src={directory.avatar(person)} size="sm" {status} statusLabel={words} />
								<span class="member-name">
									{name}{#if directory.sharesName(person)}<small>@{person.user_id}</small>{/if}{#if me}<small>(you)</small>{/if}{#if words}<span class="ap-sr">, {words.toLowerCase()}</span>{/if}
								</span>
							</button>
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
	/* Shut, it stays in the layout (hidden from everyone) so it can slide: the page moves its column, or below 960px its overlay. */
	.member-list:not(.open) { visibility: hidden; }
	.member-list-head { display: flex; align-items: center; gap: var(--space-2); height: var(--header-h); flex: none; padding: 0 var(--space-4); border-bottom: 1px solid var(--line); color: var(--ink); font-size: var(--text-body); line-height: 20px; font-weight: 600; }
	.member-list-count { color: var(--ink-muted); font-size: var(--text-sm); font-weight: 500; font-variant-numeric: tabular-nums; }
	.member-list-body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-3) var(--space-2); }
	.placeholder { display: grid; gap: var(--space-3); padding: var(--space-2) var(--space-3); }
	.placeholder .ap-skel { height: 12px; }
	.muted { margin: 0; padding: var(--space-1) var(--space-3); color: var(--ink-muted); font-size: var(--text-ui); line-height: 18px; }
	.err { color: var(--danger); }
	.add-toggle { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 32px; margin: 0 0 2px; padding: 2px var(--space-1); border: 0; border-radius: var(--radius-sm); background: none; color: var(--ink-muted); font: inherit; font-size: var(--text-ui); line-height: 18px; text-align: left; cursor: pointer; }
	.add-toggle:hover, .add-toggle[aria-expanded='true'] { color: var(--ink); }
	.add-toggle:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	/* An avatar's size, dashed: a place for someone not here yet. */
	.add-icon { display: grid; place-items: center; flex: none; width: var(--avatar-sm); height: var(--avatar-sm); border: 1px dashed currentColor; border-radius: var(--radius-full); }
	/* Raised, like a popover in place: the members stay in view below it. */
	.add { display: grid; gap: var(--space-2); margin: 0 var(--space-1) var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg-100); }
	.add-row { display: flex; gap: var(--space-2); min-width: 0; }
	.add .ap-field { flex: 1; min-width: 0; height: 28px; font-size: var(--text-ui); }
	.members { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
	.member { display: flex; align-items: center; gap: var(--space-2); min-height: 32px; padding: 2px var(--space-1); color: var(--ink); font-size: var(--text-ui); line-height: 18px; }
	/* Role badges follow the name, as beside a message's sender; the remove button takes the far right. */
	.who { display: flex; align-items: center; gap: var(--space-2); flex: 0 1 auto; min-width: 0; margin: 0; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
	.who:hover .member-name { text-decoration: underline; }
	.who:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	/* Offline members (§4.5) recede; their ring and name still read. */
	.member.offline .who { color: var(--ink-muted); }
	.member.offline :global(.ap-avatar) { opacity: .6; }
	.member-name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	/* The name comes first: the badges give up their room before it does, cut off at the right. */
	.member :global(.ap-roles) { flex: 0 10000 auto; flex-wrap: nowrap; min-width: 0; overflow: hidden; }
	.member :global(.ap-role) { flex: none; }
	.member-name small { margin-left: 4px; color: var(--ink-muted); font-size: var(--text-xs); }
	/* Remove shows on hover or focus, always on touch screens. */
	.remove { flex: none; width: 24px; height: 24px; margin-left: auto; opacity: 0; }
	.member:hover .remove, .member:focus-within .remove { opacity: 1; }
	@media (hover: none) { .remove { opacity: 1; } }
	/* Narrower, it overlays the conversation, sliding in from the right edge as the column does on wide screens. */
	@media (max-width: 959px) {
		.member-list { position: absolute; z-index: 6; top: var(--header-h); right: 0; bottom: 0; width: min(var(--member-list-w, 280px), calc(100vw - 24px)); box-shadow: var(--shadow-float); transition: transform var(--slide-time, 0s) var(--slide-ease, ease), visibility 0s; }
		.member-list:not(.open) { transform: translateX(calc(100% + 24px)); transition: transform var(--slide-time, 0s) var(--slide-ease, ease), visibility 0s var(--slide-time, 0s); }
	}
	@media (prefers-reduced-motion: reduce) {
		.member-list, .member-list:not(.open) { transition: none; }
	}
</style>
