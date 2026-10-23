<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (`data-*`, `class`, …) go on the divider. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** date: between days · new: above the first message after your `read_message_id` · gap: history unavailable before here. */
		kind?: 'date' | 'new' | 'gap';
		label?: string;
		/** date only; default true */
		sticky?: boolean;
		/** Sticky date pills show only while the timeline is scrolled away from the live end. Caught up → hidden, space kept. */
		scrolling?: boolean;
	}
	let { kind = 'date', label, sticky, scrolling, class: className, ...rest }: Props = $props();
	const text = $derived(label || (kind === 'gap' ? 'Reconnected · earlier messages aren’t available' : kind === 'new' ? 'New' : ''));
	const isSticky = $derived(kind === 'date' && sticky !== false);
	const hidden = $derived(isSticky && !scrolling);
</script>

<div role="separator" aria-label={text} aria-hidden={hidden || undefined} {...rest} class={['ap-divider', 'ap-divider-' + kind, isSticky && 'ap-divider-sticky', hidden && 'ap-divider-idle', className]}><span>{text}</span></div>
