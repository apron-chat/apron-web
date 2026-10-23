<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import TimelineLoading from './TimelineLoading.svelte';

	/** Other attributes (`data-testid`, `data-*`) go on the pane, the caller's winning and its class added. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** What is happening: "Connecting…", "Loading messages…". */
		label: string;
		/** Placeholder message rows. */
		rows?: number;
		/** In the timeline before its placeholders, such as a live region saying the connection's state. */
		children?: Snippet;
	}
	let { label, rows = 6, children, class: className, ...rest }: Props = $props();
</script>

<!-- The main pane while the app comes up (connecting, signing in, listing rooms): placeholders where the room will be, not an empty state. -->
<div {...rest} class={['ap-roomload', className]}>
	<header class="ap-roomhead"><span class="ap-skel ap-roomload-title" aria-hidden="true"></span></header>
	<div class="ap-timeline">
		{@render children?.()}
		<TimelineLoading {label} {rows} />
	</div>
</div>
