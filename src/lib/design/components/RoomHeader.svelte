<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';

	interface Props {
		room: string;
		/** the room record's `title`, falling back to `room_id` (§3.4) */
		name?: string;
		/** the room's `description` (§3.4) as one line of text */
		topic?: string;
		/** `private: true` (§4.3.4): a lock beside the name */
		private?: boolean;
		/** names from live `activity` typing; replaces the topic while present */
		typing?: string[];
		onback?: () => void;
		children?: Snippet;
		/** A thread is open in the main pane: shows `Parent › Thread`; the parent's title goes back via onroom. */
		thread?: string;
		threadName?: string;
		onroom?: () => void;
		/** Cap `rooms`: an Edit button that opens a <RoomForm> dialog, for a thread's title and summary or a room's title and description. */
		onedit?: () => void;
	}
	let { room, name, topic, private: isPrivate, typing = [], onback, children, thread, threadName, onroom, onedit }: Props = $props();
	const sub = $derived(typing.length ? (typing.length === 1 ? `${typing[0]} is typing…` : `${typing.length} people are typing…`) : topic);
</script>

{#snippet lock()}<svg class="ap-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Private"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>{/snippet}

<header class="ap-roomhead">
	{#if onback}<button type="button" class="ap-roomhead-back" onclick={onback} aria-label="Back to rooms">‹</button>{/if}
	<div class="ap-roomhead-text">
		{#if thread}
			<h1 class="ap-roomhead-name"><button type="button" class="ap-roomhead-crumb" onclick={onroom}>{name || room}</button><span class="ap-roomhead-sep" aria-hidden="true">{' › '}</span>{threadName || thread}</h1>
		{:else}
			<h1 class="ap-roomhead-name">{name || room}{#if isPrivate}{@render lock()}{/if}</h1>
		{/if}
		{#if sub}<p class={['ap-roomhead-sub', typing.length && 'ap-roomhead-typing']}>{sub}</p>{/if}
	</div>
	{#if children || onedit}
		<div class="ap-roomhead-actions">
			{#if onedit}<Button size="sm" variant="ghost" onclick={onedit} label="Edit" />{/if}
			{@render children?.()}
		</div>
	{/if}
</header>
