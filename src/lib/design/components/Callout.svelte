<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** What to know or do, such as numbered steps. */
		children?: Snippet;
		/** A button that does it, such as Install app. */
		action?: Snippet;
	}
	let { title, children, action }: Props = $props();
</script>

<aside class="ap-callout">
	<p class="ap-callout-title">{title}</p>
	{#if children}<div class="ap-callout-body">{@render children()}</div>{/if}
	{#if action}<div class="ap-callout-action">{@render action()}</div>{/if}
</aside>
