<script lang="ts">
	interface Props {
		/** date: between days · new: above the first message after your `read_message_id` · gap: history unavailable before here. */
		kind?: 'date' | 'new' | 'gap';
		label?: string;
		/** date only; default true */
		sticky?: boolean;
		/** Sticky date pills show only while the timeline is scrolled away from the live end. Caught up → hidden, space kept. */
		scrolling?: boolean;
	}
	let { kind = 'date', label, sticky, scrolling }: Props = $props();
	const text = $derived(label || (kind === 'gap' ? 'Reconnected · earlier messages aren’t available' : kind === 'new' ? 'New' : ''));
	const isSticky = $derived(kind === 'date' && sticky !== false);
	const hidden = $derived(isSticky && !scrolling);
</script>

<div class={['ap-divider', 'ap-divider-' + kind, isSticky && 'ap-divider-sticky', hidden && 'ap-divider-idle']} role="separator" aria-label={text} aria-hidden={hidden || undefined}><span>{text}</span></div>
