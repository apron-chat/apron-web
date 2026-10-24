<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import X from '@lucide/svelte/icons/x';
	/**
	 * A room's or thread's `description` (§3.4), pinned under the header: rendered + sanitized Markdown as `children`,
	 * or plain `summary`, beside the summary icon in a column of its own. It previews three lines, fading out where
	 * it's cut; a click on the text opens the rest and folds it again, and × (`ondismiss`) puts it away.
	 */
	interface Props {
		summary?: string;
		children?: Snippet;
		/** Names the region: "Thread summary" or "Room summary". */
		label?: string;
		/** Offer × to put the summary away. */
		ondismiss?: () => void;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
	}
	let { summary, children, label = 'Thread summary', ondismiss, class: className }: Props = $props();
	let expanded = $state(false);
	let boxHeight = $state(0);
	let textHeight = $state(0);
	/** The text runs past the three-line preview, so a click has more to show (and, once open, folds it again). */
	let overflows = $derived(expanded || textHeight > boxHeight + 1);

	/**
	 * The box's height and its text's, whenever either changes. Read as a ResizeObserver reports them, after the
	 * browser has laid out the frame, so reading them never lays the page out early (as `bind:clientHeight` does on
	 * mount); the clipped state lands before that frame paints.
	 */
	function heights(box: HTMLElement): (() => void) | undefined {
		const text = box.firstElementChild;
		if (typeof ResizeObserver === 'undefined' || !(text instanceof HTMLElement)) return;
		const observer = new ResizeObserver(() => {
			boxHeight = box.clientHeight;
			textHeight = text.offsetHeight;
		});
		observer.observe(box, { box: 'border-box' });
		observer.observe(text, { box: 'border-box' });
		return () => observer.disconnect();
	}

	/** A click on the text opens or folds it, but not one on a link or mention, nor the end of selecting text. */
	function click(event: MouseEvent): void {
		if (!overflows || (event.target as Element | null)?.closest('a, button, [data-room-id]')) return;
		if (window.getSelection()?.toString()) return;
		expanded = !expanded;
	}
</script>

<section aria-label={label} class={['ap-summary', ondismiss && 'ap-summary-closable', className]}>
	<!-- The region's label already says it's a summary; the icon's title says so to the pointer. -->
	<span class="ap-summary-icon" title="Summary"><TextAlignStart size={15} strokeWidth={2} aria-hidden="true" /></span>
	<!-- The pointer opens it from the text itself; the keyboard has the toggle, which shows only as a focus ring around the summary. -->
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class={['ap-summary-text', 'ap-msg-text', expanded ? 'ap-summary-open' : overflows && 'ap-summary-clipped']} {@attach heights} onclick={click}>
		<div>{#if children}{@render children()}{:else}<p>{summary}</p>{/if}</div>
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
