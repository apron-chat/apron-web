<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import TimelineLoading from './TimelineLoading.svelte';

	interface Props {
		/** What is happening: "Connecting…", "Loading messages…". */
		label: string;
		/** Placeholder message rows. */
		rows?: number;
		/** In the timeline before its placeholders, such as a live region saying the connection's state. */
		children?: Snippet;
		/** Classes for the pane, added to its own. */
		class?: ClassValue;
	}
	let { label, rows = 6, children, class: className }: Props = $props();
</script>

<!-- The main pane while the app comes up (connecting, signing in, listing rooms): placeholders where the room will be, not an empty state. -->
<div class={['ap-roomload', className]}>
	<header class="ap-roomhead"><span class="ap-skel ap-roomload-title" aria-hidden="true"></span></header>
	<div class="ap-timeline">
		{@render children?.()}
		<TimelineLoading {label} {rows} />
	</div>
</div>
