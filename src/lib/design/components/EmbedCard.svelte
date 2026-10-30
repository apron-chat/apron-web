<script lang="ts">
	/* any kind described by og (link previews, unknown kinds with og). Previews come from the server; the client never unfurls.
	   An image that waits for a click (og.image.ask) shows under the card as a MediaAsk. Its `class` and `testid` go on the
	   card, or on what holds the card and the ask. */
	import MediaAsk from './MediaAsk.svelte';
	import type { EmbedComponentProps } from './types';
	import { safeHttp } from './util';

	let props: EmbedComponentProps = $props();
	const og = $derived(props.og || {});
	const url = $derived(safeHttp(props.url));
	const img = $derived(og.image && safeHttp(og.image.url));
	const ask = $derived(!img ? og.image?.ask : undefined);
</script>

{#snippet card(className: EmbedComponentProps['class'], testid: string | undefined)}
	<svelte:element this={url ? 'a' : 'div'} href={url} rel={url ? 'noreferrer noopener' : undefined} target={url ? '_blank' : undefined} data-testid={testid} class={['ap-embed', 'ap-embed-ogcard', img && 'ap-embed-ogcard-img', className]}>
		{#if img}<img class="ap-embed-ogimg" src={img} alt={og.image?.alt || ''} loading="lazy" />{/if}
		<span class="ap-embed-cardtext">
			{#if og.site_name}<span class="ap-embed-site">{og.site_name}</span>{/if}
			<span class="ap-embed-title">{og.title || props.title || url || props.kind}</span>
			{#if og.description}<span class="ap-embed-desc">{og.description}</span>{/if}
		</span>
	</svelte:element>
{/snippet}

{#if ask}
	<div class={['ap-embed-held', props.class]} data-testid={props.testid}>
		{@render card(undefined, undefined)}
		<!-- spread: what Load and Always load do, MediaAsk's own props -->
		<MediaAsk {...ask} what={og.image?.alt || 'Image'} />
	</div>
{:else}
	{@render card(props.class, props.testid)}
{/if}
