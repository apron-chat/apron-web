<script lang="ts">
	/* upload (§4.8.4, writes §4.8.3): pending while url is absent; og.video / og.audio / og.image preview; else a file card */
	import FileGlyph from './FileGlyph.svelte';
	import type { EmbedProps } from './types';
	import { ogRatio, safeHttp } from './util';

	let { url: rawUrl, title: rawTitle, og = {}, progress, failed, detail, caption }: EmbedProps = $props();
	const url = $derived(safeHttp(rawUrl));
	const title = $derived(rawTitle || og.title || 'File');
	const pct = $derived(progress != null ? Math.round(progress * 100) : null);
	const video = $derived(og.video && safeHttp(og.video.url));
	const audio = $derived(og.audio && safeHttp(og.audio.url));
	const image = $derived(og.image && safeHttp(og.image.url));
</script>

{#if !url}
	<div class="ap-embed ap-embed-card ap-embed-pending" role="status">
		<span class="ap-embed-fileglyph"><FileGlyph /></span>
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			<span class="ap-embed-detail">{failed ? 'Upload failed' : pct != null ? `Uploading · ${pct}%` : 'Uploading…'}</span>
		</span>
		{#if pct != null && !failed}<span class="ap-embed-progress" aria-hidden="true"><i style:width="{pct}%"></i></span>{/if}
	</div>
{:else if video}
	<figure class="ap-embed ap-embed-figure">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video class="ap-embed-media" src={video} poster={image} controls preload="metadata" style={ogRatio(og.video) || ogRatio(og.image)}></video>
		<figcaption class="ap-embed-caption"><a href={url} download={title} target="_blank" rel="noreferrer noopener">{title}</a></figcaption>
	</figure>
{:else if audio}
	<div class="ap-embed ap-embed-card ap-embed-audiocard">
		<span class="ap-embed-title">{title}</span>
		<audio class="ap-embed-audio" src={audio} controls preload="none"></audio>
	</div>
{:else if image}
	<figure class="ap-embed ap-embed-figure">
		<a href={url} class="ap-embed-imagelink" target="_blank" rel="noreferrer noopener"><img class="ap-embed-media" src={image} alt={og.image?.alt || ''} loading="lazy" style={ogRatio(og.image)} /></a>
		{#if caption !== false}<figcaption class="ap-embed-caption">{title}</figcaption>{/if}
	</figure>
{:else}
	<a class="ap-embed ap-embed-card ap-embed-file" href={url} download={title} target="_blank" rel="noreferrer noopener">
		<span class="ap-embed-fileglyph"><FileGlyph /></span>
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			{#if og.description || detail}<span class="ap-embed-detail">{og.description || detail}</span>{/if}
		</span>
	</a>
{/if}
