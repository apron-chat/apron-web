<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import RoomRow from './RoomRow.svelte';
	import ThreadLines from './ThreadLines.svelte';
	import UnreadCount from './UnreadCount.svelte';
	import { roomName, roomNameTip } from './util';

	/**
	 * A thread's row (a room with a `parent_room_id`), indented under its parent's <RoomItem>, as in a <ThreadList>.
	 * It always sits in a `.ap-roomrow`, which makes room for its door on hover, whether or not it has one. The row's
	 * button names the thread in `data-thread`, or, `unjoined`, in `data-other-thread` (and `data-thread` while open).
	 */
	interface Props {
		/** The thread's `room_id`. */
		thread: string;
		/** Its `title`; without one it's called "Untitled", with its `room_id` on hover. */
		name?: string;
		/** `private: true` (§4.2.4): a lock beside the name */
		private?: boolean;
		/** The open thread: a neutral fill and an accent bar at its left, so it never reads as unread or a mention. */
		active?: boolean;
		/**
		 * A thread you haven't joined, with or without Join on it: its title muted, never tinted or stepped back. A joined
		 * one (the default) is tinted by an unread mention, and with nothing new (no unread, no mention, not open) steps
		 * back, muted and faded.
		 */
		unjoined?: boolean;
		/**
		 * Muted (§4.5 `mute` with its `room_id`, or its parent's): a bell-off beside the name, and its news stays quiet: no
		 * bold name, no tint for a mention, and a grey count, mentions too.
		 */
		muted?: boolean;
		/** Unread replies from others: a bold name and a grey count. */
		unread?: number;
		/** Unread replies whose `body.mentions` lists the viewer: the count turns orange with an @. */
		mentions?: number;
		/** Its `description` as one line of text, under its title, marked by a text icon. */
		description?: string;
		/** Its newest message, on the line after its description, marked by a reply arrow: its sender, then its text. */
		latest?: { sender?: string; text: string };
		/**
		 * When it was last active, compactly (`2h`, `Tue`), at the end of its row: for a thread you haven't joined, which
		 * has no counts (an empty `text` shows none). `datetime` is the moment in ISO 8601, `title` it in full for the tooltip
		 * ("Last active …").
		 */
		ago?: { text: string; datetime?: string; title?: string };
		/** How many messages it holds, once its history has loaded, at the end of its row in place of `ago`: for a thread read without joining. */
		count?: number;
		onselect?: () => void;
		/** Cap `rooms`, for a thread you've joined: a door-out button titled "Leave thread" on hover/focus. Sends `room_leave` (§4.2.2). */
		onleave?: (e: MouseEvent) => void;
		/** Cap `rooms`, for a thread you haven't joined: a door-in button titled "Join thread" on hover/focus. Sends `room_join` (§4.2.2). */
		onjoin?: (e: MouseEvent) => void;
		/** Prefix for its preview lines' `data-testid`s: `<linesTestid>-description` and `<linesTestid>-latest`. */
		linesTestid?: string;
		/** A `data-testid` for its time, and one for its unread bubble. */
		agoTestid?: string;
		unreadTestid?: string;
		/** The row's tooltip, such as what picking an unjoined thread does. */
		title?: string;
		/** Classes for the row's button, added to its own. */
		class?: ClassValue;
	}
	let {
		thread, name, private: isPrivate, active, unjoined = false, muted = false, unread, mentions, description, latest, ago, count, onselect, onleave, onjoin,
		linesTestid, agoTestid, unreadTestid, title, class: className
	}: Props = $props();
	const shown = $derived(roomName(name, thread, { thread: true }));
	const tip = $derived(roomNameTip(name, thread, { thread: true }));
	/** A joined thread: tinted with an unread mention, stepped back with nothing new. */
	const mention = $derived(!active && !unjoined && !muted && Boolean(mentions));
	const quiet = $derived(!active && !unjoined && !unread && !mentions);
</script>

{#snippet lines()}<ThreadLines {description} {latest} descriptionTestid={linesTestid && `${linesTestid}-description`} latestTestid={linesTestid && `${linesTestid}-latest`} />{/snippet}

<RoomRow
	room={thread} noun="thread" label={shown} {tip} private={isPrivate} {muted} {active} nested framed listed={unjoined} {title} {onselect} {onleave} {onjoin} {lines}
	class={[(unread || mentions) && !muted && 'ap-room-unread', unjoined && 'ap-room-unjoined', mention && 'ap-room-mention', quiet && 'ap-room-quiet', className]}
>
	<UnreadCount unread={unread ?? 0} mentions={mentions ?? 0} quiet={muted} noun="reply" testid={unreadTestid} />
	{#if count !== undefined}<small class="ap-room-count" aria-label={`${count} ${count === 1 ? 'message' : 'messages'}`}>{count}</small>
	{:else if ago?.text}<time class="ap-room-ago" data-testid={agoTestid} datetime={ago.datetime} title={ago.title}>{ago.text}</time>{/if}
</RoomRow>
