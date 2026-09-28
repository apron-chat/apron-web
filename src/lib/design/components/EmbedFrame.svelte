<script lang="ts">
	import Button from './Button.svelte';
	import type { EmbedProps } from './types';
	import { safeHttp } from './util';

	let props: EmbedProps = $props();
	/* `height` is a suggestion, clamped to iframe-max-h */
	const hgt = $derived(Math.min(props.height || 300, 480));
	const src = $derived(safeHttp(props.url));
</script>

{#if !props.live || !src}
	<div class="ap-embed ap-embed-frame ap-embed-paused" style="height: {hgt}px">
		<span class="ap-embed-detail">{props.title || 'Live view'}</span>
		<Button size="sm" onclick={props.onactivate} label="Load live view" />
	</div>
{:else}
	<iframe class="ap-embed ap-embed-frame" {src} sandbox="allow-scripts" loading="lazy" referrerpolicy="no-referrer" allow="" style="height: {hgt}px" title={props.title || 'Embedded view'}></iframe>
{/if}
