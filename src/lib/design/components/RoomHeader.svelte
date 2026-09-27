<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';
	import { cx } from './util';

	interface Props {
		room: string;
		/** the room record's `title`, falling back to `room_id` (§3.4) */
		name?: string;
		/** first line of the room's `intro_message` */
		topic?: string;
		/** names from live `activity` typing; replaces the topic while present */
		typing?: string[];
		onback?: () => void;
		children?: Snippet;
		/** A thread is open in the main pane: shows `Parent › Thread`; the parent's title goes back via onroom. */
		thread?: string;
		threadName?: string;
		onroom?: () => void;
		/** Cap `rooms` and/or `edit`: an Edit button that opens a <ThreadEditor>. */
		onedit?: () => void;
	}
	let { room, name, topic, typing = [], onback, children, thread, threadName, onroom, onedit }: Props = $props();
	const sub = $derived(typing.length ? (typing.length === 1 ? `${typing[0]} is typing…` : `${typing.length} people are typing…`) : topic);
</script>

<header class="ap-roomhead">
	{#if onback}<button type="button" class="ap-roomhead-back" onclick={onback} aria-label="Back to rooms">‹</button>{/if}
	<div class="ap-roomhead-text">
		{#if thread}
			<h1 class="ap-roomhead-name"><button type="button" class="ap-roomhead-crumb" onclick={onroom}>{name || room}</button><span class="ap-roomhead-sep" aria-hidden="true">{' › '}</span>{threadName || thread}</h1>
		{:else}
			<h1 class="ap-roomhead-name">{name || room}</h1>
		{/if}
		{#if sub}<p class={cx('ap-roomhead-sub', typing.length && 'ap-roomhead-typing')}>{sub}</p>{/if}
	</div>
	{#if children || (thread && onedit)}
		<div class="ap-roomhead-actions">
			{#if thread && onedit}<Button size="sm" variant="ghost" onclick={onedit} label="Edit" />{/if}
			{@render children?.()}
		</div>
	{/if}
</header>
