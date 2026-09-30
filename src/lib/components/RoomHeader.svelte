<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import Users from '@lucide/svelte/icons/users';
	import type { RoomSnapshot } from '$lib/protocol/client';
	import { markdownText } from '$lib/protocol/markdown';

	interface Props {
		/** The top-level room. */
		room: RoomSnapshot;
		/** The room whose history the header reports on: the open thread, else the room. */
		pane: RoomSnapshot;
		/** The open thread's title; undefined in the room view. */
		threadTitle?: string;
		/** Names typing in this room, other than the viewer. */
		typing: string[];
		/** Replies in the open thread, once its history has loaded. */
		replyCount?: number;
		/** Older replies are not loaded yet, so `replyCount` is a lower bound. */
		moreReplies?: boolean;
		/** Show Edit for the room, or the open thread (capability `rooms`): its title and description. */
		canEdit: boolean;
		editorOpen: boolean;
		editDisabled: boolean;
		/** Offer Leave for the pane's room or thread (capability `rooms`). */
		canLeave: boolean;
		/** Offer Join for a thread open without joining it (capability `rooms`). */
		canJoin?: boolean;
		/** Whether the room member list is visible. */
		memberListOpen: boolean;
		onback: () => void;
		onroom: () => void;
		onedit: () => void;
		onleave: () => void;
		onjoin?: () => void;
		onmemberlist: () => void;
	}
	let {
		room, pane, threadTitle, typing, replyCount, moreReplies = false, canEdit, editorOpen, editDisabled, canLeave, canJoin = false,
		memberListOpen, onback, onroom, onedit, onleave, onjoin, onmemberlist
	}: Props = $props();

	let memberListToggle = $state<HTMLButtonElement | undefined>();
	/** The room's description (§3.4) as one line of text under its title; a thread shows its own as a summary instead. */
	let topic = $derived(threadTitle === undefined && room.description ? markdownText(room.description).split('\n')[0] : '');
	let thread = $derived(threadTitle !== undefined);

	/** Where focus goes when the member list collapses from under it. */
	export function focusMemberListToggle(): void {
		memberListToggle?.focus();
	}
</script>

<header class="ap-roomhead">
	<button class="ap-roomhead-back" type="button" aria-label="Back to rooms" onclick={onback}>‹</button>
	<div class="ap-roomhead-text">
		{#if threadTitle !== undefined}
			<h1 class="ap-roomhead-name">
				<button class="ap-roomhead-crumb" type="button" aria-label="Back to room" onclick={onroom}>{room.title}</button>
				<span class="ap-roomhead-sep" aria-hidden="true"> › </span>
				{threadTitle}{#if pane.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}
			</h1>
		{:else}
			<h1 class="ap-roomhead-name">{room.title}{#if room.private}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</h1>
		{/if}
		{#if typing.length > 0}
			<p class="ap-roomhead-sub ap-roomhead-typing typing-head">{typing.length === 1 ? `${typing[0]} is typing…` : `${typing.length} people are typing…`}</p>
		{:else if replyCount !== undefined}
			<p class="ap-roomhead-sub">{replyCount}{moreReplies ? '+' : ''} {replyCount === 1 && !moreReplies ? 'reply' : 'replies'}</p>
		{:else if topic}
			<p class="ap-roomhead-sub" data-testid="room-description" title={room.description}>{topic}</p>
		{/if}
	</div>
	{#if pane.recovering || pane.loading}
		<span class="ap-roomhead-sub" role="status">Loading history…</span>
	{:else if pane.recoveryError}
		<span class="ap-roomhead-sub" role="status">History unavailable</span>
	{/if}
	{#if canEdit || canLeave || canJoin}
		<div class="ap-roomhead-actions">
			{#if canJoin}
				<button class="ap-btn ap-btn-sm" type="button" data-testid="join-room" aria-label={threadTitle !== undefined ? 'Join thread' : 'Join room'} disabled={editDisabled} onclick={onjoin}>Join</button>
			{/if}
			{#if canEdit}
				<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" aria-label={thread ? 'Edit thread' : 'Edit room'} aria-expanded={editorOpen} disabled={editDisabled} onclick={onedit}>Edit</button>
			{/if}
			{#if canLeave}
				<button class="ap-btn ap-btn-ghost ap-btn-sm" type="button" data-testid="leave-room" aria-label={threadTitle !== undefined ? 'Leave thread' : 'Leave room'} disabled={editDisabled} onclick={onleave}>Leave</button>
			{/if}
		</div>
	{/if}
	<button bind:this={memberListToggle} class="ap-iconbtn member-list-toggle" class:member-list-toggle-open={memberListOpen} type="button" aria-label={memberListOpen ? 'Hide member list' : 'Show member list'} aria-expanded={memberListOpen} title={memberListOpen ? 'Hide member list' : 'Show member list'} onclick={onmemberlist}>
		<Users size={18} strokeWidth={1.8} aria-hidden="true" />
	</button>
</header>

<style>
	.ap-roomhead-back { display: none; }
	.ap-roomhead-name { max-width: 100%; }
	.ap-roomhead-actions { flex: none; }
	.member-list-toggle { flex: none; }
	.member-list-toggle-open { color: var(--ink); background: var(--bg-300); }
	/* Typing shows in the header's subtitle only on phones; wide layouts have the row above the composer. */
	.typing-head { display: none; }
	@media (max-width: 719px) {
		.ap-roomhead-back { display: block; }
		.typing-head { display: block; }
	}
</style>
