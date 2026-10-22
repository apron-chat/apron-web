<script lang="ts">
	/* iframe (§4.8): sandboxed with scripts but never same-origin, no referrer; a paused placeholder until `live`, and a fallback card without a usable address */
	import Button from './Button.svelte';
	import EmbedFallback from './EmbedFallback.svelte';
	import type { EmbedProps } from './types';
	import { safeHttp } from './util';

	let props: EmbedProps = $props();
	/* `height` is a suggestion, clamped to iframe-max-h */
	const hgt = $derived(Math.min(props.height && props.height > 0 ? props.height : 300, 480));
	const src = $derived(safeHttp(props.url));
</script>

{#if !src}
	<EmbedFallback kind="iframe" text="This live view has no usable address." testid={props.testid} />
{:else if !props.live}
	<div class="ap-embed ap-embed-frame ap-embed-paused" style="height: {hgt}px" data-testid={props.testid}>
		<span class="ap-embed-detail">{props.title || 'Live view'}</span>
		<Button size="sm" onclick={props.onactivate} label="Load live view" />
	</div>
{:else}
	<iframe class="ap-embed ap-embed-frame" {src} sandbox="allow-scripts" loading="lazy" referrerpolicy="no-referrer" allow="" style="height: {hgt}px" title={props.title || 'Embedded view'} data-testid={props.testid}></iframe>
{/if}
