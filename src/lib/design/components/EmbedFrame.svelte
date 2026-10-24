<script lang="ts">
	/* iframe (§4.8): sandboxed with scripts but never same-origin, no referrer; a paused placeholder until `live`, and a fallback card without a usable address.
	   Its `class` and `testid` go on whichever of the three shows. */
	import Button from './Button.svelte';
	import EmbedFallback from './EmbedFallback.svelte';
	import type { EmbedComponentProps } from './types';
	import { safeHttp } from './util';

	let props: EmbedComponentProps = $props();
	/* `height` is a suggestion, clamped to iframe-max-h */
	const hgt = $derived(Math.min(props.height && props.height > 0 ? props.height : 300, 480));
	const src = $derived(safeHttp(props.url));
	const style = $derived(`height: ${hgt}px`);
</script>

{#if !src}
	<EmbedFallback kind="iframe" text="This live view has no usable address." class={props.class} testid={props.testid} />
{:else if !props.live}
	<div data-testid={props.testid} class={['ap-embed', 'ap-embed-frame', 'ap-embed-paused', props.class]} {style}>
		<span class="ap-embed-detail">{props.title || 'Live view'}</span>
		<Button size="sm" onclick={props.onactivate} label="Load live view" />
	</div>
{:else}
	<!-- The sandbox, no referrer and no permissions: they are what keeps the frame safe. -->
	<iframe loading="lazy" title={props.title || 'Embedded view'} data-testid={props.testid} class={['ap-embed', 'ap-embed-frame', props.class]} {style} sandbox="allow-scripts" referrerpolicy="no-referrer" allow="" {src}></iframe>
{/if}
