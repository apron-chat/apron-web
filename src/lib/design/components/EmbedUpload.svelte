<script lang="ts">
	/* upload (§4.6.4, writes §4.6.3): pending while url is absent; og.image / og.video / og.audio preview; else a file card */
	import FileGlyph from './FileGlyph.svelte';
	import type { EmbedProps } from './types';
	import { ogRatio, safeHttp } from './util';

	let props: EmbedProps = $props();
	const og = $derived(props.og || {});
	const url = $derived(safeHttp(props.url));
	const title = $derived(props.title || og.title || 'File');
	const pct = $derived(props.progress != null ? Math.round(props.progress * 100) : null);
</script>

{#if !url}
	<div class="ap-embed ap-embed-card ap-embed-pending" role="status">
		<span class="ap-embed-fileglyph"><FileGlyph /></span>
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			<span class="ap-embed-detail">{props.failed ? 'Upload failed' : pct != null ? `Uploading · ${pct}%` : 'Uploading…'}</span>
		</span>
		{#if pct != null && !props.failed}<span class="ap-embed-progress" aria-hidden="true"><i style="width: {pct}%"></i></span>{/if}
	</div>
{:else if og.video && safeHttp(og.video.url)}
	<figure class="ap-embed ap-embed-figure">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video class="ap-embed-media" src={safeHttp(og.video.url)} poster={og.image && safeHttp(og.image.url)} controls preload="metadata" style={ogRatio(og.video) || ogRatio(og.image)}></video>
		<figcaption class="ap-embed-caption"><a href={url} download={title}>{title}</a></figcaption>
	</figure>
{:else if og.audio && safeHttp(og.audio.url)}
	<div class="ap-embed ap-embed-card ap-embed-audiocard">
		<span class="ap-embed-title">{title}</span>
		<audio class="ap-embed-audio" src={safeHttp(og.audio.url)} controls preload="none"></audio>
	</div>
{:else if og.image && safeHttp(og.image.url)}
	<figure class="ap-embed ap-embed-figure">
		<a href={url} class="ap-embed-imagelink"><img class="ap-embed-media" src={safeHttp(og.image.url)} alt={og.image.alt || ''} loading="lazy" style={ogRatio(og.image)} /></a>
		{#if props.caption !== false}<figcaption class="ap-embed-caption">{title}</figcaption>{/if}
	</figure>
{:else}
	<a class="ap-embed ap-embed-card ap-embed-file" href={url} download={title}>
		<span class="ap-embed-fileglyph"><FileGlyph /></span>
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			{#if og.description || props.detail}<span class="ap-embed-detail">{og.description || props.detail}</span>{/if}
		</span>
	</a>
{/if}
