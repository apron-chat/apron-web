<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import type { ClassValue } from 'svelte/elements';
	import Faces from './Faces.svelte';
	import FoldPill from './FoldPill.svelte';
	import RoomRow from './RoomRow.svelte';
	import type { Face } from './types';
	import UnreadCount from './UnreadCount.svelte';
	import { roomName } from './util';

	/**
	 * A room's row in the rooms list, or a listed room's under Other Rooms (with its `topic`, joined by picking it).
	 * A thread's row is a <ThreadItem>. The row's button names the room in `data-room`, or in `data-join` while `listed`.
	 */
	interface Props {
		room: string;
		/** `title`, falling back to `room_id` (§3.4) */
		name?: string;
		/** the room's `description` (§3.4) as one line of text */
		topic?: string;
		/** `private: true` (§4.2.4): a lock beside the name */
		private?: boolean;
		/** Who a private room is with, before its name: one person's face with their status, or two of a group's (Faces). */
		faces?: Face[];
		/**
		 * Muted (§4.5 `mute` with its `room_id`): a bell-off at the end of the row, before its count, and its news stays quiet: no bold name, and
		 * a grey count, mentions too.
		 */
		muted?: boolean;
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
		/** The open room folded to its threads with news: a FoldPill at the end of its row, before its +, that shows them all. */
		onexpand?: () => void;
		/** Listed under Other Rooms, and joined by picking it, rather than one of your rooms. */
		listed?: boolean;
		/** The row's tooltip, such as an untitled room's `room_id`. */
		title?: string;
		/** The keys that act on the row besides picking it (`aria-keyshortcuts`), such as the ones that move it. */
		keyshortcuts?: string;
		/** A `data-testid` for its unread bubble, one for its +, and one for its …. */
		unreadTestid?: string;
		newThreadTestid?: string;
		expandTestid?: string;
		/** Classes for the row's button, added to its own. */
		class?: ClassValue;
	}
	let { room, name, topic, private: isPrivate, faces, muted = false, unread, mentions, active, loading, onselect, onleave, onnewthread, onexpand, listed, title, keyshortcuts, unreadTestid, newThreadTestid, expandTestid, class: className }: Props = $props();
	const shown = $derived(roomName(name, room));

	/** The … goes once it has unfolded the threads: keyboard focus moves to the row's button rather than dropping to the page. */
	function expand(event: MouseEvent): void {
		(event.currentTarget as HTMLElement).closest('.ap-roomstart')?.querySelector<HTMLElement>('.ap-room')?.focus();
		onexpand?.();
	}
</script>

{#snippet lead()}{#if faces?.length}<Faces people={faces} size="sm" />{/if}{/snippet}
{#snippet lines()}{#if topic}<span class="ap-room-topic">{topic}</span>{/if}{/snippet}
{#snippet start()}
	<span class="ap-room-ends">
		{#if onexpand}<FoldPill label="Show all threads in {shown}" title="Show all threads" testid={expandTestid} onclick={expand} />{/if}
		{#if onnewthread}<button type="button" class="ap-iconbtn ap-room-new" data-testid={newThreadTestid} aria-label="New thread in {shown}" title="New thread" onclick={onnewthread}><Plus size={16} aria-hidden="true" /></button>{/if}
	</span>
{/snippet}

<RoomRow
	{room} noun="room" label={shown} private={isPrivate} {muted} {active} {listed} {title} {onselect} {onleave} {keyshortcuts} lead={faces?.length ? lead : undefined} {lines} start={onnewthread || onexpand ? start : undefined}
	class={[(unread || mentions) && !muted && 'ap-room-unread', faces?.length && 'ap-room-faced', className]}
>
	<UnreadCount unread={unread ?? 0} mentions={mentions ?? 0} quiet={muted} noun="message" testid={unreadTestid} />
	{#if loading}<span class="ap-room-loading" aria-label="Loading history">…</span>{/if}
</RoomRow>
