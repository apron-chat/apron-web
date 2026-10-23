<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	/** Extra attributes go on the callout. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		title: string;
		/** What to know or do, such as numbered steps. */
		children?: Snippet;
		/** A button that does it, such as Install app. */
		action?: Snippet;
	}
	let { title, children, action, class: className, ...rest }: Props = $props();
</script>

<!-- A note within its section, not a landmark of its own (as <aside> would be). -->
<div role="note" {...rest} class={['ap-callout', className]}>
	<p class="ap-callout-title">{title}</p>
	{#if children}<div class="ap-callout-body">{@render children()}</div>{/if}
	{#if action}<div class="ap-callout-action">{@render action()}</div>{/if}
</div>
