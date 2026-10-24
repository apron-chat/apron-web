<script lang="ts">
	/* a kind this client can't render: its kind, and the link or text it carries (§3.5). Its `class` and `testid` go on the card. */
	import type { EmbedComponentProps } from './types';
	import { safeHttp } from './util';
	let props: EmbedComponentProps = $props();
	const url = $derived(safeHttp(props.url));
</script>

<div data-testid={props.testid} class={['ap-embed', 'ap-embed-card', 'ap-embed-fallback', props.class]}>
	<span class="ap-embed-kind">{props.kind || 'unknown'}</span>
	{#if url}<a class="ap-embed-url" href={url} rel="noreferrer noopener" target="_blank">{url}</a>
	{:else if props.text}<span class="ap-embed-detail">{props.text}</span>
	{:else}<span class="ap-embed-detail">This client can’t display this embed.</span>{/if}
</div>
