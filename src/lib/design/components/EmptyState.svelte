<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** What's here: "Nothing here yet", "No room open". */
		title?: string;
		/** A line on what to do: "Start the conversation in General.". */
		detail?: string;
		/** Before the title, or in its place, such as a StatusBanner saying the connection is down. */
		children?: Snippet;
		/** Under the rest, such as a button. */
		actions?: Snippet;
		/** Classes for its box, added to its own. */
		class?: ClassValue;
	}
	let { title, detail, children, actions, class: className }: Props = $props();
</script>

<!-- The main pane, or the timeline, with nothing in it: centered in the space it would take. -->
<div class={['ap-empty', className]}>
	{@render children?.()}
	{#if title}<h2 class="ap-empty-title">{title}</h2>{/if}
	{#if detail}<p class="ap-empty-detail">{detail}</p>{/if}
	{@render actions?.()}
</div>
