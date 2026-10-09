<script lang="ts">
	import { count99 } from './util';

	interface Props {
		room: string;
		/** `title`, falling back to `room_id` */
		name?: string;
		/** the room's `description` (§3.4) as one line of text */
		topic?: string;
		/** `private: true` (§4.3.4): a lock beside the name */
		private?: boolean;
		unread?: number;
		/** unread messages whose `body.mentions` lists the viewer; an @ badge that quiets the plain count. */
		mentions?: number;
		/** The open room or thread: a neutral fill and an accent bar at its left, so it never reads as unread or a mention. */
		active?: boolean;
		/**
		 * A thread (room with `parent_room_id`) indented under its parent. Joined: an unread mention tints it, and with
		 * nothing new (no unread, no mention, not open) it steps back, muted and faded.
		 */
		nested?: boolean;
		/** A thread's summary (its `description`) as one line of text, under its title, marked by a text icon. */
		summary?: string;
		/** A thread's newest message, on the line after its summary, marked by a reply arrow: its sender, then its text. */
		latest?: { sender?: string; text: string };
		/** When it was last active, compactly (`2h`, `Tue`), at the end of its row: for a thread you haven't joined, which has no counts. */
		ago?: string;
		onselect?: () => void;
		/** Cap `rooms`: a door button titled "Exit" on hover/focus. Sends `room_leave` (§4.3.2). */
		onleave?: (e: MouseEvent) => void;
		/**
		 * Cap `rooms`, for a thread you haven't joined: a door-in button titled "Join" on hover/focus, where a joined
		 * one has Exit, and its title muted. Sends `room_join` (§4.3.2).
		 */
		onjoin?: (e: MouseEvent) => void;
	}
	let { room, name, topic, private: isPrivate, unread, mentions, active, nested, summary, latest, ago, onselect, onleave, onjoin }: Props = $props();
	const shown = $derived(name || room);
	/** A joined thread: tinted with an unread mention, stepped back with nothing new. */
	const mention = $derived(nested && !active && !onjoin && Boolean(mentions));
	const quiet = $derived(nested && !active && !onjoin && !unread && !mentions);
</script>

{#snippet row()}
	<button type="button" class={['ap-room', nested && 'ap-room-nested', active && 'ap-room-active', unread && 'ap-room-unread', onjoin && 'ap-room-unjoined', mention && 'ap-room-mention', quiet && 'ap-room-quiet']} aria-current={active ? 'page' : undefined} onclick={onselect}>
		<span class="ap-room-text"><span class="ap-room-name">{shown}{#if isPrivate}<svg class="ap-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Private"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>{/if}</span>{#if topic}<span class="ap-room-topic">{topic}</span>{/if}{#if summary}<span class="ap-room-line ap-room-line-summary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Summary"><path d="M21 5H3" /><path d="M15 12H3" /><path d="M17 19H3" /></svg><span class="ap-room-line-text">{summary}</span></span>{/if}{#if latest}<span class="ap-room-line ap-room-line-latest"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Latest message"><path d="m15 10 5 5-5 5" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></svg><span class="ap-room-line-text">{#if latest.sender}<span class="ap-room-sender">{latest.sender}</span>{' '}{/if}{latest.text}</span></span>{/if}</span>
		{#if mentions}<span class="ap-count ap-count-at" aria-label="{mentions} {mentions === 1 ? 'mention' : 'mentions'}">@{mentions > 1 ? mentions : ''}</span>{/if}
		{#if unread}<span class={['ap-count', mentions && 'ap-count-quiet']} aria-label="{unread} unread">{count99(unread)}</span>{/if}
		{#if ago}<span class="ap-room-ago">{ago}</span>{/if}
	</button>
{/snippet}

{#if onjoin}
	<div class={['ap-roomrow', nested && 'ap-roomrow-nested', active && 'ap-roomrow-active']}>
		{@render row()}
		<button type="button" class="ap-room-join" title="Join" aria-label="Join {shown}" onclick={(e) => { e.stopPropagation(); onjoin(e); }}>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></svg>
		</button>
	</div>
{:else if onleave}
	<div class={['ap-roomrow', nested && 'ap-roomrow-nested', active && 'ap-roomrow-active']}>
		{@render row()}
		<button type="button" class="ap-room-exit" title="Exit" aria-label="Exit {shown}" onclick={(e) => { e.stopPropagation(); onleave(e); }}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 4h3a2 2 0 0 1 2 2v14" /><path d="M2 20h3" /><path d="M13 20h9" /><path d="M10 12v.01" /><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" /></svg>
		</button>
	</div>
{:else}
	{@render row()}
{/if}
