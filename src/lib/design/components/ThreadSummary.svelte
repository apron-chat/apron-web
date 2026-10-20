<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	/**
	 * A room's or thread's `description` (§3.4), pinned under the header: rendered + sanitized Markdown as `children`,
	 * or plain `summary`. It previews three lines, fading out where it's cut; a click on the text opens the rest and
	 * folds it again, and × (`ondismiss`) puts it away.
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
	/** The text runs past the three-line preview, so a click has more to show (and, once open, folds it again). */
	let overflows = $derived(expanded || textHeight > boxHeight + 1);

	/** A click on the text opens or folds it, but not one on a link or mention, nor the end of selecting text. */
	function click(event: MouseEvent): void {
		if (!overflows || (event.target as Element | null)?.closest('a, button, [data-room-id]')) return;
		if (window.getSelection()?.toString()) return;
		expanded = !expanded;
	}
</script>

<section class={['ap-summary', ondismiss && 'ap-summary-closable']} aria-label={label}>
	<!-- The pointer opens it from the text itself; the keyboard has the toggle, which shows only as a focus ring around the summary. -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class={['ap-summary-text', 'ap-msg-text', expanded ? 'ap-summary-open' : overflows && 'ap-summary-clipped']} bind:clientHeight={boxHeight} onclick={click}>
		<div bind:offsetHeight={textHeight}>{#if children}{@render children()}{:else}<p>{summary}</p>{/if}</div>
	</div>
	{#if overflows}
		<button class="ap-summary-toggle" type="button" aria-expanded={expanded} aria-label={expanded ? 'Show less of the summary' : 'Show the whole summary'} onclick={() => (expanded = !expanded)}></button>
	{/if}
	{#if ondismiss}
		<button class="ap-iconbtn ap-summary-close" type="button" aria-label="Hide summary" title="Hide summary" onclick={ondismiss}>
			<X size={14} strokeWidth={2} aria-hidden="true" />
		</button>
	{/if}
</section>
