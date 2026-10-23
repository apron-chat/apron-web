<script lang="ts">
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { chain } from './util';

	/**
	 * The row RoomItem and ThreadItem share (not exported): the button with the name, a lock when private, what goes
	 * under the name and what ends the row, and the door out or in beside it. Other attributes go on the button, the
	 * caller's winning, its class merged and its `onclick` run before `onselect` (`preventDefault()` skips it).
	 */
	interface Props extends HTMLButtonAttributes {
		/** Its `room_id`, which its door names in `data-leave` or `data-join`. */
		room: string;
		/** What it is, for its door's tooltip: "Leave thread". */
		noun: 'room' | 'thread';
		/** The name as shown, and its tooltip. */
		label: string;
		tip?: string;
		private?: boolean;
		active?: boolean;
		/** A thread indented under its parent. */
		nested?: boolean;
		/** Always in a `.ap-roomrow`, which makes room for its door on hover, whether or not it has one. */
		framed?: boolean;
		onselect?: () => void;
		/** The door out, on hover or focus. */
		onleave?: (e: MouseEvent) => void;
		/** The door in, on hover or focus. */
		onjoin?: (e: MouseEvent) => void;
		/** In its text, after the name: a room's topic, a thread's preview lines. */
		lines?: Snippet;
		/** After its text, in the button: counts, the time, the loading …. */
		children?: Snippet;
		/** After the button, where it has no door: the open room's +. */
		start?: Snippet;
	}
	let { room, noun, label, tip, private: isPrivate, active, nested, framed, onselect, onleave, onjoin, lines, children, start, class: className, onclick, ...rest }: Props = $props();
</script>

{#snippet row()}
	<button type="button" aria-current={active ? 'page' : undefined} {...rest} class={['ap-room', nested && 'ap-room-nested', active && 'ap-room-active', className]} onclick={chain(onselect, onclick)}>
		<span class="ap-room-text"><span class="ap-room-name" title={tip}>{label}{#if isPrivate}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>{@render lines?.()}</span>
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
