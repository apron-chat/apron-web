<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import RoomRow from './RoomRow.svelte';
	import UnreadCount from './UnreadCount.svelte';
	import { roomName } from './util';

	/**
	 * A room's row in the rooms list, or a listed room's under Browse rooms (with its `topic`, joined by picking it).
	 * A thread's row is a <ThreadItem>. Other attributes (`data-*`, `title`) go on the row's button, the caller's
	 * winning: its class is added, and its `onclick` runs before `onselect` (`preventDefault()` skips `onselect`).
	 */
	interface Props extends HTMLButtonAttributes {
		room: string;
		/** `title`, falling back to `room_id` (§3.4) */
		name?: string;
		/** the room's `description` (§3.4) as one line of text */
		topic?: string;
		/** `private: true` (§4.2.4): a lock beside the name */
		private?: boolean;
		/** Unread messages from others: a bold name and a grey count. */
		unread?: number;
		/** Unread messages whose `body.mentions` lists the viewer: the count turns orange with an @. */
		mentions?: number;
		/** The open room: a neutral fill and an accent bar at its left, so it never reads as unread or a mention. */
		active?: boolean;
		/** Its history is still loading: a … at the end of its row. */
		loading?: boolean;
		onselect?: () => void;
		/** Cap `rooms`: a door-out button titled "Leave room" on hover/focus. Sends `room_leave` (§4.2.2). */
		onleave?: (e: MouseEvent) => void;
		/** A + at the end of the open room's row, always shown, that starts a thread in it (where there is no `onleave`). */
		onnewthread?: () => void;
		/** A `data-testid` for its unread bubble, and one for its +. */
		unreadTestid?: string;
		newThreadTestid?: string;
	}
	let { room, name, topic, private: isPrivate, unread, mentions, active, loading, onselect, onleave, onnewthread, unreadTestid, newThreadTestid, class: className, ...rest }: Props = $props();
	const shown = $derived(roomName(name, room));
</script>

{#snippet lines()}{#if topic}<span class="ap-room-topic">{topic}</span>{/if}{/snippet}
{#snippet start()}
	<button type="button" class="ap-iconbtn ap-room-new" data-testid={newThreadTestid} aria-label="New thread in {shown}" title="New thread" onclick={onnewthread}><Plus size={16} aria-hidden="true" /></button>
{/snippet}

<RoomRow
	{...rest} {room} noun="room" label={shown} private={isPrivate} {active} {onselect} {onleave} {lines} start={onnewthread ? start : undefined}
	class={[(unread || mentions) && 'ap-room-unread', className]}
>
	<UnreadCount unread={unread ?? 0} mentions={mentions ?? 0} noun="message" testid={unreadTestid} />
	{#if loading}<span class="ap-room-loading" aria-label="Loading history">…</span>{/if}
</RoomRow>
