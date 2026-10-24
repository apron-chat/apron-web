<script lang="ts">
	/* Renders one entry of body.embeds by picking the renderer for its kind (§4.8). An unknown kind is never an error.
	   Its `class` and `testid` go on the renderer's root. */
	import EmbedCard from './EmbedCard.svelte';
	import EmbedFallback from './EmbedFallback.svelte';
	import EmbedFrame from './EmbedFrame.svelte';
	import EmbedHtml from './EmbedHtml.svelte';
	import EmbedStream from './EmbedStream.svelte';
	import EmbedUpload from './EmbedUpload.svelte';
	import type { EmbedComponentProps } from './types';

	let props: EmbedComponentProps = $props();
	const Renderer = $derived(
		props.kind === 'upload' ? EmbedUpload
		: props.kind === 'stream' ? EmbedStream
		: props.kind === 'iframe' ? EmbedFrame
		: props.kind === 'html' ? EmbedHtml
		: props.og ? EmbedCard
		: EmbedFallback
	);
</script>

<!-- spread: a dispatcher; every renderer takes the same props, the embed's fields, so it hands them all on -->
<Renderer {...props} />
