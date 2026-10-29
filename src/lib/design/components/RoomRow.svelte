<script lang="ts">
	import BellOff from '@lucide/svelte/icons/bell-off';
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	/**
	 * The row RoomItem and ThreadItem share (not exported): the button with the name, a lock when private, what goes
	 * under the name and what ends the row, and the door out or in beside it. The button names its room: a room's in
	 * `data-room`, or `data-join` while `listed`; a thread's in `data-thread`, or `data-other-thread` while `listed`
	 * (with `data-thread` too while it's open).
	 */
	interface Props {
		/** Its `room_id`, which its button names, and its door in `data-leave` or `data-join`. */
		room: string;
		/** What it is, for its door's tooltip: "Leave thread". */
		noun: 'room' | 'thread';
		/** The name as shown, and its tooltip. */
		label: string;
		tip?: string;
		private?: boolean;
		/** Muted (§4.5 `mute` with its `room_id`): a bell-off at the end of the row, before its count or time. */
		muted?: boolean;
		active?: boolean;
		/** A thread indented under its parent. */
		nested?: boolean;
		/** Always in a `.ap-roomrow`, which makes room for its door on hover, whether or not it has one. */
		framed?: boolean;
		/** Not yours yet: a room listed under More rooms, a thread you haven't joined. */
		listed?: boolean;
		/** The button's tooltip. */
		title?: string;
		/** Classes for the button, added to its own. */
		class?: ClassValue;
		onselect?: () => void;
		/** The door out, on hover or focus. */
		onleave?: (e: MouseEvent) => void;
		/** The door in, on hover or focus. */
		onjoin?: (e: MouseEvent) => void;
		/** In the button, before its text: a private room's faces. */
		lead?: Snippet;
		/** In its text, after the name: a room's topic, a thread's preview lines. */
		lines?: Snippet;
		/** After its text, in the button: counts, the time, the loading …. */
		children?: Snippet;
		/** After the button, where it has no door: the open room's +. */
		start?: Snippet;
	}
	let { room, noun, label, tip, private: isPrivate, muted, active, nested, framed, listed = false, title, onselect, onleave, onjoin, lead, lines, children, start, class: className }: Props = $props();
	const thread = $derived(noun === 'thread');
</script>

{#snippet row()}
	<button
		type="button" aria-current={active ? 'page' : undefined} {title}
		data-room={thread || listed ? undefined : room} data-join={!thread && listed ? room : undefined}
		data-thread={thread && (!listed || active) ? room : undefined} data-other-thread={thread && listed ? room : undefined}
		class={['ap-room', nested && 'ap-room-nested', active && 'ap-room-active', className]} onclick={onselect}
	>
		{@render lead?.()}
		<span class="ap-room-text"><span class="ap-room-name"><span class="ap-room-label" title={tip}>{label}</span>{#if isPrivate}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>{@render lines?.()}</span>
		{#if muted}<BellOff class="ap-muted" role="img" aria-label="Muted" />{/if}
		{@render children?.()}
	</button>
{/snippet}

{#if framed || onjoin || onleave}
	<div class={['ap-roomrow', nested && 'ap-roomrow-nested', active && 'ap-roomrow-active']}>
		{@render row()}
		{#if onleave}
			<button type="button" class="ap-room-exit" data-leave={room} title="Leave {noun}" aria-label="Leave {label}" onclick={onleave}><DoorOpen size={15} aria-hidden="true" /></button>
		{/if}
		{#if onjoin}
			<button type="button" class="ap-room-join" data-join={room} title="Join {noun}" aria-label="Join {label}" onclick={onjoin}><LogIn size={15} aria-hidden="true" /></button>
		{/if}
	</div>
{:else if start}
	<div class="ap-roomstart">
		{@render row()}
		{@render start()}
	</div>
{:else}
	{@render row()}
{/if}
