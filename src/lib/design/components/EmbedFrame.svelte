<script lang="ts">
	/* iframe (§4.8): sandboxed with scripts but never same-origin, no referrer; a paused placeholder until `live`, and a fallback card without a usable address.
	   Other attributes go on whichever of the three shows; the frame's address and sandbox stay its own. */
	import Button from './Button.svelte';
	import EmbedFallback from './EmbedFallback.svelte';
	import type { EmbedComponentProps } from './types';
	import { embedAttributes, safeHttp } from './util';

	let props: EmbedComponentProps = $props();
	const attributes = $derived(embedAttributes(props));
	/* `height` is a suggestion, clamped to iframe-max-h */
	const hgt = $derived(Math.min(props.height && props.height > 0 ? props.height : 300, 480));
	const src = $derived(safeHttp(props.url));
	/* Its height, then any style of yours. */
	const style = $derived([`height: ${hgt}px`, attributes.style].filter(Boolean).join('; '));
</script>

{#if !src}
	<EmbedFallback kind="iframe" text="This live view has no usable address." {...attributes} />
{:else if !props.live}
	<div {...attributes} class={['ap-embed', 'ap-embed-frame', 'ap-embed-paused', attributes.class]} {style}>
		<span class="ap-embed-detail">{props.title || 'Live view'}</span>
		<Button size="sm" onclick={props.onactivate} label="Load live view" />
	</div>
{:else}
	<!-- The sandbox and the address come after your attributes (the sandbox first): they are what keeps the frame safe. -->
	<iframe loading="lazy" title={props.title || 'Embedded view'} {...attributes} class={['ap-embed', 'ap-embed-frame', attributes.class]} {style} sandbox="allow-scripts" referrerpolicy="no-referrer" allow="" {src}></iframe>
{/if}
