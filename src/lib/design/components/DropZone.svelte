<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (`data-*`) go on the zone. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** What dropping does. */
		label?: string;
	}
	let { label = 'Drop files to attach', ...rest }: Props = $props();
</script>

<!-- Over the pane it's placed in (position: relative) while files are dragged onto it; drag events pass through to the pane. -->
<div {...rest} class="ap-dropzone" aria-hidden="true"><span>{label}</span></div>
