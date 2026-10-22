<script lang="ts">
	import DoorOpen from '@lucide/svelte/icons/door-open';
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import Plus from '@lucide/svelte/icons/plus';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import ThreadLines from './ThreadLines.svelte';
	import UnreadCount from './UnreadCount.svelte';
	import { roomName } from './util';

	/** Other attributes (`data-*`, `title`) go on the row's button. */
	interface Props extends HTMLButtonAttributes {
		room: string;
		/** `title`, falling back to `room_id` */
		name?: string;
		/** the room's `description` (§3.4) as one line of text */
		topic?: string;
		/** `private: true` (§4.2.4): a lock beside the name */
		private?: boolean;
		/** Unread messages from others: a bold name and a grey count. */
		unread?: number;
		/** Unread messages whose `body.mentions` lists the viewer: the count turns orange with an @. */
		mentions?: number;
		/** The open room or thread: a neutral fill and an accent bar at its left, so it never reads as unread or a mention. */
		active?: boolean;
		/**
		 * A thread (room with `parent_room_id`) indented under its parent. Joined: an unread mention tints it, and with
		 * nothing new (no unread, no mention, not open) it steps back, muted and faded.
		 */
		nested?: boolean;
		/** A thread you haven't joined, with or without Join on it: its title muted, never tinted or stepped back. On by default with `onjoin`. */
		unjoined?: boolean;
		/** A thread's summary (its `description`) as one line of text, under its title, marked by a text icon. */
		summary?: string;
		/** A thread's newest message, on the line after its summary, marked by a reply arrow: its sender, then its text. */
		latest?: { sender?: string; text: string };
		/** When it was last active, compactly (`2h`, `Tue`), at the end of its row: for a thread you haven't joined, which has no counts. */
		ago?: string;
		/** `ago`'s moment as an ISO 8601 `datetime`, and in full for its tooltip ("Last active …"). */
		agoIso?: string;
		agoTitle?: string;
		/** How many messages it holds, once its history has loaded, at the end of its row in place of `ago`: for a thread read without joining. */
		count?: number;
		/** Its history is still loading: a … at the end of its row. */
		loading?: boolean;
		/** Prefix for `data-testid`s: `<testid>-summary` and `<testid>-latest` on its preview lines, `<testid>-ago` on its time. */
		testid?: string;
		/** A `data-testid` for its unread bubble. */
		countTestid?: string;
		onselect?: () => void;
		/** Cap `rooms`: a door-out button titled "Leave thread" (or room) on hover/focus. Sends `room_leave` (§4.2.2). */
		onleave?: (e: MouseEvent) => void;
		/**
		 * Cap `rooms`, for a thread you haven't joined: a door-in button titled "Join thread" on hover/focus, where a
		 * joined one has Leave. Sends `room_join` (§4.2.2).
		 */
		onjoin?: (e: MouseEvent) => void;
		/** A + at the end of the open room's row, always shown, that starts a thread in it. */
		onnewthread?: () => void;
	}
	let { room, name, topic, private: isPrivate, unread, mentions, active, nested, unjoined, summary, latest, ago, agoIso, agoTitle, count, loading, testid, countTestid, onselect, onleave, onjoin, onnewthread, ...rest }: Props = $props();
	const shown = $derived(roomName(name, room));
	const outside = $derived(unjoined ?? Boolean(onjoin));
	/** A joined thread: tinted with an unread mention, stepped back with nothing new. */
	const mention = $derived(nested && !active && !outside && Boolean(mentions));
	const quiet = $derived(nested && !active && !outside && !unread && !mentions);
	const noun = $derived(nested ? 'thread' : 'room');
</script>

{#snippet row()}
	<button type="button" {...rest} class={['ap-room', nested && 'ap-room-nested', active && 'ap-room-active', (unread || mentions) && 'ap-room-unread', outside && 'ap-room-unjoined', mention && 'ap-room-mention', quiet && 'ap-room-quiet']} aria-current={active ? 'page' : undefined} onclick={onselect}>
		<span class="ap-room-text"><span class="ap-room-name">{shown}{#if isPrivate}<Lock class="ap-lock" role="img" aria-label="Private" />{/if}</span>{#if topic}<span class="ap-room-topic">{topic}</span>{/if}<ThreadLines {summary} {latest} {testid} /></span>
		<UnreadCount unread={unread ?? 0} mentions={mentions ?? 0} noun={nested ? 'reply' : 'message'} testid={countTestid} />
		{#if count !== undefined}<small class="ap-room-count" aria-label={`${count} ${count === 1 ? 'message' : 'messages'}`}>{count}</small>
		{:else if ago}<time class="ap-room-ago" data-testid={testid && `${testid}-ago`} datetime={agoIso} title={agoTitle}>{ago}</time>{/if}
		{#if loading}<span class="ap-room-loading" aria-label="Loading history">…</span>{/if}
	</button>
{/snippet}

<!-- A thread's row always sits in a .ap-roomrow, which makes room for its action on hover, whether or not it has one. -->
{#if nested || onjoin || onleave}
	<div class={['ap-roomrow', nested && 'ap-roomrow-nested', active && 'ap-roomrow-active']}>
		{@render row()}
		{#if onleave}
			<button type="button" class="ap-room-exit" data-leave={room} title="Leave {noun}" aria-label="Leave {shown}" onclick={onleave}><DoorOpen size={15} aria-hidden="true" /></button>
		{/if}
		{#if onjoin}
			<button type="button" class="ap-room-join" data-join={room} title="Join {noun}" aria-label="Join {shown}" onclick={onjoin}><LogIn size={15} aria-hidden="true" /></button>
		{/if}
	</div>
{:else if onnewthread}
	<div class="ap-roomstart">
		{@render row()}
		<button type="button" class="ap-iconbtn ap-room-new" data-testid="create-thread" aria-label="New thread in {shown}" title="New thread" onclick={onnewthread}><Plus size={16} aria-hidden="true" /></button>
	</div>
{:else}
	{@render row()}
{/if}
