<script lang="ts">
	import TypingDots from './TypingDots.svelte';
	interface Props {
		/** Cap `activity`: names with a live `typing` (seconds) that hasn't expired. */
		names?: string[];
	}
	let { names = [] }: Props = $props();
	const who = $derived(names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : 'Several people are typing');
</script>

<div class="ap-typing" aria-live="polite">{#if names.length}<TypingDots />{who}…{/if}</div>
