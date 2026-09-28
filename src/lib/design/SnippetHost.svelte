<script lang="ts">
	/* Renders several snippets in a row; backs Apron.parts() in the bundle. */
	import type { Snippet } from 'svelte';

	interface Props {
		snippets: Snippet[];
	}
	let { snippets }: Props = $props();
</script>

{#each snippets as snippet, i (i)}{@render snippet()}{/each}
