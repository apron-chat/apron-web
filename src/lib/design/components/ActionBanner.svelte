<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** What happened, in a few words: "Apron has been updated". */
		title: string;
		/** One more line, such as what the action costs. */
		detail?: string;
		/** Drawn in an accent circle before the title, such as a reload arrow. */
		icon?: Snippet;
		/** The buttons: a quiet Later, then the one thing to do. */
		action?: Snippet;
		testid?: string;
	}
	let { title, detail, icon, action, testid }: Props = $props();
</script>

<!-- On the accent, since it offers something to do; StatusBanner's dots are for the connection's state. -->
<div class="ap-banner" role="status" data-testid={testid}>
	{#if icon}<span class="ap-banner-icon" aria-hidden="true">{@render icon()}</span>{/if}
	<span class="ap-banner-text">
		<span class="ap-banner-title">{title}</span>
		{#if detail}<span class="ap-banner-detail">{detail}</span>{/if}
	</span>
	{#if action}<span class="ap-banner-actions">{@render action()}</span>{/if}
</div>
