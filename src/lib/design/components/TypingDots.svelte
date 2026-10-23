<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	/** Three bouncing dots, beside words that say what's happening. */
	interface Props {
		/** Classes for the dots, added to their own. */
		class?: ClassValue;
	}
	let { class: className }: Props = $props();
</script>

<span aria-hidden="true" class={['ap-typing-dots', className]}><i></i><i></i><i></i></span>
