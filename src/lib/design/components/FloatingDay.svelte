<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (`data-*`) go on its row. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** The day of the messages at the top of the view: "Today", "Monday, 12 October". */
		label: string;
		/** Showing: while the timeline scrolls, and not over the date divider it repeats. */
		shown?: boolean;
	}
	let { label, shown = false, ...rest }: Props = $props();
</script>

<!-- First in the timeline: a zero-height sticky row, so the pill floats over the messages without taking space. -->
<div {...rest} class={['ap-dayfloat', shown && 'ap-dayfloat-shown']} aria-hidden="true"><span class="ap-dayfloat-pill">{label}</span></div>
