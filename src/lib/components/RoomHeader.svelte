<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Lock from '@lucide/svelte/icons/lock';
	import LogOut from '@lucide/svelte/icons/log-out';
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Users from '@lucide/svelte/icons/users';
	import type { RoomSnapshot } from '$lib/protocol/client';
	import { markdownText } from '$lib/protocol/markdown';
	import MenuButton from '$lib/design/components/MenuButton.svelte';

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
		/** Offer Edit for the room, or the open thread (capability `rooms`): its title and description. */
		canEdit: boolean;
		/** Join and the actions menu can't be used now, such as while a request is in flight. */
		editDisabled: boolean;
		/** Offer Leave for the pane's room or thread (capability `rooms`). */
		canLeave: boolean;
		/** Offer Join for a thread open without joining it (capability `rooms`). */
		canJoin?: boolean;
		/** Whether the rooms list beside the conversation is expanded (wide layouts; phones go back to it instead). */
		sidebarOpen: boolean;
		/** Whether the room member list is visible. */
		memberListOpen: boolean;
		onback: () => void;
		onroom: () => void;
		onedit: () => void;
		onleave: () => void;
		onjoin?: () => void;
		onsidebar: () => void;
		onmemberlist: () => void;
	}
	let {
		room, pane, threadTitle, typing, replyCount, moreReplies = false, canEdit, editDisabled, canLeave, canJoin = false,
		sidebarOpen, memberListOpen, onback, onroom, onedit, onleave, onjoin, onsidebar, onmemberlist
	}: Props = $props();

	let memberListToggle = $state<HTMLButtonElement | undefined>();
	/** The room's description (§3.4) as one line of text under its title; a thread shows its own as a summary instead. */
	let topic = $derived(threadTitle === undefined && room.description ? markdownText(room.description).split('\n')[0] : '');
	let thread = $derived(threadTitle !== undefined);
	let noun = $derived(thread ? 'thread' : 'room');
	/** The occasional actions, in the ⋯ menu: Join stays a button, since it's what a pane read without joining is for. */
	let actions = $derived([
		...(canEdit ? [{ value: 'edit', label: `Edit ${noun}`, testid: 'edit-room' }] : []),
		...(canLeave ? [{ value: 'leave', label: `Leave ${noun}`, testid: 'leave-room' }] : [])
	]);

	function act(value: string): void {
		if (value === 'edit') onedit();
		else if (value === 'leave') onleave();
	}

	/** Where focus goes when the member list collapses from under it. */
	export function focusMemberListToggle(): void {
		memberListToggle?.focus();
	}
</script>

<header class="ap-roomhead">
	<!-- At the start of the title bar, as the member list's toggle is at its end. -->
	<button class={['ap-iconbtn', 'sidebar-toggle', !sidebarOpen && 'closed']} type="button" aria-label={sidebarOpen ? 'Hide rooms' : 'Show rooms'} aria-expanded={sidebarOpen} title={sidebarOpen ? 'Hide rooms' : 'Show rooms'} onclick={onsidebar}>
		<span class="sidebar-icons" aria-hidden="true">
			<PanelLeftClose size={18} strokeWidth={1.8} />
			<PanelLeftOpen size={18} strokeWidth={1.8} />
		</span>
	</button>
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
	<!-- Recovering or loading shows at the foot of the timeline (TimelineLoading), where the new messages will appear. -->
	{#if pane.recoveryError}
		<span class="ap-roomhead-sub" role="status">History unavailable</span>
	{/if}
	{#if canJoin}
		<button class="ap-btn ap-btn-sm" type="button" data-testid="join-room" aria-label={thread ? 'Join thread' : 'Join room'} title={thread ? 'Get its replies live, and list it under the room' : 'Get its messages live, and list it with your rooms'} disabled={editDisabled} onclick={onjoin}>Join</button>
	{/if}
	<button bind:this={memberListToggle} class={['ap-iconbtn', 'member-list-toggle', memberListOpen && 'ap-iconbtn-on']} type="button" aria-label={memberListOpen ? 'Hide member list' : 'Show member list'} aria-expanded={memberListOpen} title={memberListOpen ? 'Hide member list' : 'Show member list'} onclick={onmemberlist}>
		<Users size={18} strokeWidth={1.8} aria-hidden="true" />
	</button>
	{#if actions.length > 0}
		<MenuButton label={thread ? 'Thread actions' : 'Room actions'} testid="room-actions" choices={actions} disabled={editDisabled} onselect={act}>
			{#snippet icon()}<Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />{/snippet}
			{#snippet lead(value)}{#if value === 'edit'}<Pencil size={15} aria-hidden="true" />{:else}<LogOut size={15} aria-hidden="true" />{/if}{/snippet}
		</MenuButton>
	{/if}
</header>

<style>
	.ap-roomhead-back { display: none; }
	.ap-roomhead-name { max-width: 100%; }
	.member-list-toggle, .sidebar-toggle { flex: none; }
	/* The two panel icons cross-fade, sliding the way the list moves. */
	.sidebar-icons { position: relative; width: 18px; height: 18px; }
	.sidebar-icons :global(svg) { position: absolute; inset: 0; transition: opacity 140ms ease, transform 180ms ease; }
	.sidebar-icons :global(svg:last-child) { opacity: 0; transform: translateX(-4px); }
	.closed .sidebar-icons :global(svg:first-child) { opacity: 0; transform: translateX(4px); }
	.closed .sidebar-icons :global(svg:last-child) { opacity: 1; transform: none; }
	/* Typing shows in the header's subtitle only on phones; wide layouts have the row above the composer. */
	.typing-head { display: none; }
	@media (max-width: 719px) {
		.ap-roomhead-back { display: block; }
		.sidebar-toggle { display: none; }
		.typing-head { display: block; }
	}
	@media (prefers-reduced-motion: reduce) {
		.sidebar-icons :global(svg) { transition: none; }
	}
</style>
