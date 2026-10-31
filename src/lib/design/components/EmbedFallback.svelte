<script lang="ts">
	/* a kind this client can't render (§3.5.2): its kind, plus its `title` and a link to its `url` if present (else `text`,
	   a note such as why EmbedFrame can't load). Its `class` and `testid` go on the card. */
	import type { EmbedComponentProps } from './types';
	import { safeHttp } from './util';
	let props: EmbedComponentProps = $props();
	const url = $derived(safeHttp(props.url));
</script>

<div data-testid={props.testid} class={['ap-embed', 'ap-embed-card', 'ap-embed-fallback', props.class]}>
	<span class="ap-embed-kind">{props.kind || 'unknown'}</span>
	{#if props.title}<span class="ap-embed-title" dir="auto">{props.title}</span>{/if}
	{#if url}<a class="ap-embed-url" href={url} rel="noreferrer noopener" target="_blank">{url}</a>
	{:else if props.text}<span class="ap-embed-detail">{props.text}</span>
	{:else}<span class="ap-embed-detail">This client can’t display this embed.</span>{/if}
</div>
