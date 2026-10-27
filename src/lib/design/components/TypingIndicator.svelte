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
</script>

<!-- Each name is isolated in a <bdi>, so one written right to left can't reorder the words around it. -->
<div aria-live="polite" class={['ap-typing', className]}>{#if names.length}<TypingDots />{#if names.length === 1}<bdi>{names[0]}</bdi> is typing{:else if names.length === 2}<bdi>{names[0]}</bdi> and <bdi>{names[1]}</bdi> are typing{:else}Several people are typing{/if}…{/if}</div>
