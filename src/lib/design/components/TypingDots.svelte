<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';

	/** Three bouncing dots, beside words that say what's happening. Attributes (`class`, …) go on them. */
	let { class: className, ...rest }: HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span aria-hidden="true" {...rest} class={['ap-typing-dots', className]}><i></i><i></i><i></i></span>
