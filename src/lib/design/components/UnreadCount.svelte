<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { count99 } from './util';

	interface Props {
		/** Unread messages from others. */
		unread: number;
		/** How many of them mention you (or arrived as an edit adding you). */
		mentions: number;
		/** What's counted, for the label: `message` on a room (the default), `reply` on a thread. */
		noun?: 'message' | 'reply';
		/** Classes for the bubble, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the bubble. */
		testid?: string;
	}
	let { unread, mentions, noun = 'message', class: className, testid }: Props = $props();
	/** A mention may be an edit that adds you to a message already read, so it counts at least once. */
	let count = $derived(Math.max(unread, mentions));
	let label = $derived(`${count} unread ${count === 1 ? noun : noun === 'reply' ? 'replies' : 'messages'}${mentions ? `, ${mentions === 1 ? 'a mention' : `${mentions} mentions`} of you` : ''}`);
</script>

<!-- What's new, in one bubble: grey for unread messages, orange with an @ when they include a mention of you. Its label is its hover title too. -->
{#if count > 0}
	<span aria-label={label} title={label} data-testid={testid} class={['ap-count', mentions ? 'ap-count-at' : 'ap-count-quiet', className]}>{#if mentions}@&#8239;{/if}{count99(count)}</span>
{/if}
