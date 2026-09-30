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
		active?: boolean;
		/** a thread (room with `parent_room_id`) indented under its parent */
		nested?: boolean;
		onselect?: () => void;
		/** Cap `rooms`: a door button titled "Exit" on hover/focus. Sends `room_leave` (§4.3.2). */
		onleave?: (e: MouseEvent) => void;
	}
	let { room, name, topic, private: isPrivate, unread, mentions, active, nested, onselect, onleave }: Props = $props();
	const shown = $derived(name || room);
</script>

{#snippet row()}
	<button type="button" class={['ap-room', nested && 'ap-room-nested', active && 'ap-room-active', unread && 'ap-room-unread']} aria-current={active ? 'page' : undefined} onclick={onselect}>
		<span class="ap-room-text"><span class="ap-room-name">{shown}{#if isPrivate}<svg class="ap-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Private"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>{/if}</span>{#if topic}<span class="ap-room-topic">{topic}</span>{/if}</span>
		{#if mentions}<span class="ap-count ap-count-at" aria-label="{mentions} {mentions === 1 ? 'mention' : 'mentions'}">@{mentions > 1 ? mentions : ''}</span>{/if}
		{#if unread}<span class={['ap-count', mentions && 'ap-count-quiet']} aria-label="{unread} unread">{count99(unread)}</span>{/if}
	</button>
{/snippet}

{#if onleave}
	<div class={['ap-roomrow', nested && 'ap-roomrow-nested', active && 'ap-roomrow-active']}>
		{@render row()}
		<button type="button" class="ap-room-exit" title="Exit" aria-label="Exit {shown}" onclick={(e) => { e.stopPropagation(); onleave(e); }}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 4h3a2 2 0 0 1 2 2v14" /><path d="M2 20h3" /><path d="M13 20h9" /><path d="M10 12v.01" /><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" /></svg>
		</button>
	</div>
{:else}
	{@render row()}
{/if}
