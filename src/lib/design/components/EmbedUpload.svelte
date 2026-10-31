<script lang="ts">
	/* upload (§4.8.4, writes §4.8.3): pending while url is absent; og.video / og.audio / og.image preview; else a file card.
	   A preview that waits for a click (its `ask`) shows under the file card as a MediaAsk. Its `class` and `testid` go on
	   whichever of those shows, or on what holds the file card and the ask. */
	import FileIcon from '@lucide/svelte/icons/file';
	import FileX from '@lucide/svelte/icons/file-x';
	import MediaAsk from './MediaAsk.svelte';
	import type { EmbedComponentProps } from './types';
	import { ogRatio, plainClick, safeHttp } from './util';

	let { url: rawUrl, title: rawTitle, og = {}, progress, failed, detail, onview, viewer, class: className, testid }: EmbedComponentProps = $props();
	const url = $derived(safeHttp(rawUrl));
	const title = $derived(rawTitle || og.title || 'File');
	const pct = $derived(progress != null ? Math.round(progress * 100) : null);
	const video = $derived(og.video && safeHttp(og.video.url));
	const audio = $derived(og.audio && safeHttp(og.audio.url));
	const image = $derived(og.image && safeHttp(og.image.url));
	/** The preview that waits for a click, the one that would show first: none while one may load. */
	const ask = $derived(video || audio || image ? undefined : og.video?.ask ? { ...og.video.ask, what: 'Video' } : og.audio?.ask ? { ...og.audio.ask, what: 'Audio' } : og.image?.ask ? { ...og.image.ask, what: og.image.alt || 'Image' } : undefined);
	const pending = $derived(failed ? (typeof failed === 'string' ? `Upload failed · ${failed}` : 'Upload failed') : `${detail ? `${detail} · ` : ''}${pct != null ? `Uploading · ${pct}%` : 'Uploading…'}`);
</script>

{#snippet glyph()}<span class="ap-embed-fileglyph">{#if failed}<FileX size={20} aria-hidden="true" />{:else}<FileIcon size={20} aria-hidden="true" />{/if}</span>{/snippet}

{#if !url}
	<div role="status" data-testid={testid} class={['ap-embed', 'ap-embed-card', 'ap-embed-pending', failed && 'ap-embed-failed', className]}>
		{@render glyph()}
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			<span class="ap-embed-detail">{pending}</span>
		</span>
		{#if pct != null && !failed}<span class="ap-embed-progress" aria-hidden="true"><i style:width="{pct}%"></i></span>{/if}
	</div>
{:else if video}
	<figure data-testid={testid} class={['ap-embed', 'ap-embed-figure', className]}>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video class="ap-embed-media" src={video} poster={image} controls preload="metadata" style={ogRatio(og.video) || ogRatio(og.image)}></video>
		<figcaption class="ap-embed-caption"><a href={url} download={title} target="_blank" rel="noreferrer noopener">{title}</a></figcaption>
	</figure>
{:else if audio}
	<div data-testid={testid} class={['ap-embed', 'ap-embed-card', 'ap-embed-audiocard', className]}>
		<span class="ap-embed-title">{title}</span>
		<audio class="ap-embed-audio" src={audio} controls preload="none"></audio>
	</div>
{:else if image}
	<figure data-testid={testid} class={['ap-embed', 'ap-embed-figure', className]}>
		<a data-viewer-src={viewer?.src} data-viewer-title={viewer?.title} data-viewer-alt={viewer?.alt} data-viewer-detail={viewer?.detail} data-viewer-width={viewer?.width} data-viewer-height={viewer?.height}
			href={url} class="ap-embed-imagelink" target="_blank" rel="noreferrer noopener" aria-haspopup={onview ? 'dialog' : undefined} title={onview ? `View ${title}` : undefined}
			onclick={(event) => { if (onview && plainClick(event)) { event.preventDefault(); onview(event); } }}><img class="ap-embed-media" src={image} alt={og.image?.alt || ''} loading="lazy" style={ogRatio(og.image)} /></a>
		<figcaption class="ap-embed-caption">{title}</figcaption>
	</figure>
{:else if ask}
	<div data-testid={testid} class={['ap-embed-held', className]}>
		{@render file(undefined, undefined)}
		<!-- spread: what Load and Always load do, and what waits: MediaAsk's own props -->
		<MediaAsk {...ask} />
	</div>
{:else}
	{@render file(className, testid)}
{/if}

{#snippet file(fileClass: EmbedComponentProps['class'], fileTestid: string | undefined)}
	<a href={url} download={title} target="_blank" rel="noreferrer noopener" data-testid={fileTestid} class={['ap-embed', 'ap-embed-card', 'ap-embed-file', fileClass]}>
		{@render glyph()}
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			{#if og.description || detail}<span class="ap-embed-detail">{og.description || detail}</span>{/if}
		</span>
	</a>
{/snippet}
