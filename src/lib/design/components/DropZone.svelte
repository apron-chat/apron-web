<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	/** "Drop files to attach". */
	interface Props {
		/** Classes for the zone, added to its own. */
		class?: ClassValue;
	}
	let { class: className }: Props = $props();
</script>

<!-- Over the pane it's placed in (position: relative) while files are dragged onto it; drag events pass through to the pane. -->
<div aria-hidden="true" class={['ap-dropzone', className]}><span>Drop files to attach</span></div>
