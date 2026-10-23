<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { times } from './util';

	/**
	 * A line the timeline writes itself, between messages: who joined and left
	 * (§4.2.2), or a thread's new name. Centred and quiet, like a system
	 * message's line, with no sender, actions or focus of its own.
	 */
	interface Props {
		/** What happened, as plain text. */
		text?: string;
		/** Instead of `text`, such as a quoted thread title in the message face. */
		children?: Snippet;
		/** Epoch ms of the `log_id` it stands for. */
		timestamp?: number;
		/** Pre-formatted time; overrides the short time `timestamp` renders. */
		time?: string;
		/** Join and leave lines: smaller and tighter, the time only on hover or focus. */
		quiet?: boolean;
		/** The `log_id` it stands for, as its `data-log-id`. */
		logId?: string;
		/** One of the timeline's rows, as a message is: `data-timeline-item`, which a timeline finds its rows by. */
		timelineItem?: boolean;
		/** Its tooltip, such as everyone a join and leave line names. */
		title?: string;
		/** Classes for the line, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for the line. */
		testid?: string;
	}
	let { text, children, timestamp, time, quiet, logId, timelineItem = false, title, class: className, testid }: Props = $props();
	const t = $derived(times(timestamp, time));
</script>

<div data-timeline-item={timelineItem ? '' : undefined} data-testid={testid} data-log-id={logId} {title} class={['ap-msg', 'ap-msg-system', quiet && 'ap-msg-member', className]}>
	<div class="ap-msg-system-body">{#if children}{@render children()}{:else}{text}{/if}</div>
	{#if t.short}<time class="ap-msg-system-time" datetime={t.iso} title={t.exact}>{t.short}</time>{/if}
</div>
