<script lang="ts">
	/* Renders one entry of body.embeds by picking the renderer for its kind (§4.6). An unknown kind is never an error. */
	import EmbedCard from './EmbedCard.svelte';
	import EmbedFallback from './EmbedFallback.svelte';
	import EmbedFrame from './EmbedFrame.svelte';
	import EmbedHtml from './EmbedHtml.svelte';
	import EmbedStream from './EmbedStream.svelte';
	import EmbedUpload from './EmbedUpload.svelte';
	import type { EmbedProps } from './types';

	let props: EmbedProps = $props();
</script>

{#if props.kind === 'upload'}<EmbedUpload {...props} />
{:else if props.kind === 'stream'}<EmbedStream {...props} />
{:else if props.kind === 'iframe'}<EmbedFrame {...props} />
{:else if props.kind === 'html'}<EmbedHtml {...props} />
{:else if props.og}<EmbedCard {...props} />
{:else}<EmbedFallback {...props} />{/if}
