<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	/** Other attributes (`data-testid`, `data-*`) go on the zone, the caller's winning and its class added. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** What dropping does. */
		label?: string;
	}
	let { label = 'Drop files to attach', class: className, ...rest }: Props = $props();
</script>

<!-- Over the pane it's placed in (position: relative) while files are dragged onto it; drag events pass through to the pane. -->
<div aria-hidden="true" {...rest} class={['ap-dropzone', className]}><span>{label}</span></div>
