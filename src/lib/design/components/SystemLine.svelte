<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { times } from './util';

	/**
	 * A line the timeline writes itself, between messages: who joined and left
	 * (§4.2.2), or a thread's new name. Centred and quiet, like a system
	 * message's line, with no sender, actions or focus of its own. Other
	 * attributes (`data-*`, `title`, `class`) go on the line.
	 */
	interface Props extends HTMLAttributes<HTMLDivElement> {
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
	}
	let { text, children, timestamp, time, quiet, class: className, ...rest }: Props = $props();
	const t = $derived(times(timestamp, time));
</script>

<div {...rest} class={['ap-msg', 'ap-msg-system', quiet && 'ap-msg-member', className]}>
	<div class="ap-msg-system-body">{#if children}{@render children()}{:else}{text}{/if}</div>
	{#if t.short}<time class="ap-msg-system-time" datetime={t.iso} title={t.exact}>{t.short}</time>{/if}
</div>
