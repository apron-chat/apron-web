<script lang="ts">
	/* a kind this client can't render: its kind, and the link or text it carries (§3.5) */
	import type { EmbedProps } from './types';
	import { safeHttp } from './util';
	let props: EmbedProps = $props();
	const url = $derived(safeHttp(props.url));
</script>

<div class="ap-embed ap-embed-card ap-embed-fallback" data-testid={props.testid}>
	<span class="ap-embed-kind">{props.kind || 'unknown'}</span>
	{#if url}<a class="ap-embed-url" href={url} rel="noreferrer noopener" target="_blank">{url}</a>
	{:else if props.text}<span class="ap-embed-detail">{props.text}</span>
	{:else}<span class="ap-embed-detail">This client can’t display this embed.</span>{/if}
</div>
