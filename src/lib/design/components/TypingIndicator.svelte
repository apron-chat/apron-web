<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import TypingDots from './TypingDots.svelte';

	interface Props {
		/** Cap `activity`: names with a live `typing` (seconds) that hasn't expired. */
		names?: string[];
		/** Classes for the line, added to its own. */
		class?: ClassValue;
	}
	let { names = [], class: className }: Props = $props();
	const who = $derived(names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : 'Several people are typing');
</script>

<div aria-live="polite" class={['ap-typing', className]}>{#if names.length}<TypingDots />{who}…{/if}</div>
