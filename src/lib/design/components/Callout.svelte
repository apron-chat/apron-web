<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		title: string;
		/** `warn`: something stands in the way, such as a limit reached, on a warning rule, and read out as it appears. */
		tone?: 'info' | 'warn';
		/** What to know or do, such as numbered steps. */
		children?: Snippet;
		/** A button that does it, such as Install app. */
		action?: Snippet;
		/** Classes for the callout, added to its own. */
		class?: ClassValue;
	}
	let { title, tone = 'info', children, action, class: className }: Props = $props();
</script>

<!-- A note within its section, not a landmark of its own (as <aside> would be); a warning is announced. -->
<div role={tone === 'warn' ? 'alert' : 'note'} class={['ap-callout', tone === 'warn' && 'ap-callout-warn', className]}>
	<p class="ap-callout-title">{title}</p>
	{#if children}<div class="ap-callout-body">{@render children()}</div>{/if}
	{#if action}<div class="ap-callout-action">{@render action()}</div>{/if}
</div>
