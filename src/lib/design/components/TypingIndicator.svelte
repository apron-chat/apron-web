<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import TypingDots from './TypingDots.svelte';

	/** Other attributes (`data-*`, `class`, …) go on the line. */
	interface Props extends HTMLAttributes<HTMLDivElement> {
		/** Cap `activity`: names with a live `typing` (seconds) that hasn't expired. */
		names?: string[];
	}
	let { names = [], class: className, ...rest }: Props = $props();
	const who = $derived(names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : 'Several people are typing');
</script>

<div aria-live="polite" {...rest} class={['ap-typing', className]}>{#if names.length}<TypingDots />{who}…{/if}</div>
