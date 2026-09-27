<script lang="ts">
	/* any kind described by og (link previews, unknown kinds with og). Previews come from the server; the client never unfurls. */
	import type { EmbedProps } from './types';
	import { cx, safeHttp } from './util';

	let props: EmbedProps = $props();
	const og = $derived(props.og || {});
	const url = $derived(safeHttp(props.url));
	const img = $derived(og.image && safeHttp(og.image.url));
</script>

<svelte:element this={url ? 'a' : 'div'} class={cx('ap-embed', 'ap-embed-ogcard', img && 'ap-embed-ogcard-img')} href={url} rel={url ? 'noreferrer noopener' : undefined} target={url ? '_blank' : undefined}>
	{#if img}<img class="ap-embed-ogimg" src={img} alt={og.image?.alt || ''} loading="lazy" />{/if}
	<span class="ap-embed-cardtext">
		{#if og.site_name}<span class="ap-embed-site">{og.site_name}</span>{/if}
		<span class="ap-embed-title">{og.title || props.title || url || props.kind}</span>
		{#if og.description}<span class="ap-embed-desc">{og.description}</span>{/if}
	</span>
</svelte:element>
