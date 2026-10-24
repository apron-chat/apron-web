<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	interface Props {
		/** The day of the messages at the top of the view: "Today", "Monday, 12 October". */
		label: string;
		/** Showing: while the timeline scrolls, and not over the date divider it repeats. */
		shown?: boolean;
		/** Classes for its row, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its row. */
		testid?: string;
	}
	let { label, shown = false, class: className, testid }: Props = $props();
</script>

<!-- First in the timeline: a zero-height sticky row, so the pill floats over the messages without taking space. -->
<div aria-hidden="true" data-testid={testid} class={['ap-dayfloat', shown && 'ap-dayfloat-shown', className]}><span class="ap-dayfloat-pill">{label}</span></div>
