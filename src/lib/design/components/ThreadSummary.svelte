<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	/**
	 * A room's or thread's `description` (§3.4), pinned under the header: rendered + sanitized Markdown as `children`,
	 * or plain `summary`. It previews three lines, with More to read the rest, and × (`ondismiss`) puts it away.
	 */
	interface Props {
		summary?: string;
		children?: Snippet;
		/** Names the region: "Thread summary" or "Room summary". */
		label?: string;
		/** Offer × to put the summary away. */
		ondismiss?: () => void;
	}
	let { summary, children, label = 'Thread summary', ondismiss }: Props = $props();
	let expanded = $state(false);
	let boxHeight = $state(0);
	let textHeight = $state(0);
	/** The text runs past the three-line preview, so More has something to show (and, once open, Less to fold it). */
	let overflows = $derived(expanded || textHeight > boxHeight + 1);
</script>

<section class="ap-summary" aria-label={label}>
	<div class="ap-summary-head">
		<span class="ap-summary-label">Summary</span>
		{#if overflows}
			<button class="ap-link ap-summary-more" type="button" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>{expanded ? 'Less' : 'More'}</button>
		{/if}
		{#if ondismiss}
			<button class="ap-iconbtn ap-summary-close" type="button" aria-label="Hide summary" title="Hide summary" onclick={ondismiss}>
				<X size={14} strokeWidth={2} aria-hidden="true" />
			</button>
		{/if}
	</div>
	<div class={['ap-summary-text', 'ap-msg-text', expanded ? 'ap-summary-open' : overflows && 'ap-summary-clipped']} bind:clientHeight={boxHeight}>
		<div bind:offsetHeight={textHeight}>{#if children}{@render children()}{:else}<p>{summary}</p>{/if}</div>
	</div>
</section>
