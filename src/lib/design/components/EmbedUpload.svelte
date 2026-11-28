<script lang="ts">
	/* upload (§4.8.4, writes §4.8.3): pending while url is absent; og.video / og.audio / og.image preview; else a file card,
	   which a plain click shows full screen where `onpreview` is given (a Markdown file). An animated image
	   (`og.image.animated`) plays as `autoplay` says, and its corner button plays and pauses it; a click on the picture
	   still shows it full screen, playing.
	   A preview that waits for a click (its `ask`) shows under the file card as a MediaAsk. Its `class` and `testid` go on
	   whichever of those shows, or on what holds the file card and the ask. */
	import FileIcon from '@lucide/svelte/icons/file';
	import FileX from '@lucide/svelte/icons/file-x';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import AnimatedImage from './AnimatedImage.svelte';
	import AudioPlayer from './AudioPlayer.svelte';
	import MediaAsk from './MediaAsk.svelte';
	import type { EmbedComponentProps } from './types';
	import { ogRatio, plainClick, safeHttp } from './util';

	let { url: rawUrl, title: rawTitle, og = {}, progress, failed, detail, onview, onpreview, viewer, autoplay = true, class: className, testid }: EmbedComponentProps = $props();
	/**
	 * A video fetches its poster and metadata only as it nears the screen, not every one in the history loaded
	 * (`loading` on media: Chrome 148; others load as before). Spread, as Svelte's types don't know it on `<video>` yet.
	 */
	const lazyMedia = { loading: 'lazy' };
	const url = $derived(safeHttp(rawUrl));
	const title = $derived(rawTitle || og.title || 'File');
	const pct = $derived(progress != null ? Math.round(progress * 100) : null);
	const video = $derived(og.video && safeHttp(og.video.url));
	/** The gated URL itself (a `MediaSrc`, for AudioPlayer), where it is a safe one. */
	const audio = $derived(og.audio?.url && safeHttp(og.audio.url) ? og.audio.url : undefined);
	const image = $derived(og.image && safeHttp(og.image.url));
	/** The preview that waits for a click, the one that would show first: none while one may load. */
	const ask = $derived(video || audio || image ? undefined : og.video?.ask ? { ...og.video.ask, what: 'Video', kind: 'video' as const } : og.audio?.ask ? { ...og.audio.ask, what: 'Audio', kind: 'audio' as const } : og.image?.ask ? { ...og.image.ask, what: og.image.alt || 'Image', kind: 'image' as const } : undefined);
	/** An animated image held still: as `autoplay` says, until its button says otherwise. */
	let paused = $derived(!autoplay);
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
		<!-- spread: `loading`, which Svelte's types don't know on <video> yet (see lazyMedia) -->
		<video class="ap-embed-media" src={video} poster={image} controls preload="metadata" {...lazyMedia} style={ogRatio(og.video) || ogRatio(og.image)}></video>
		<figcaption class="ap-embed-caption"><a href={url} download={title} target="_blank" rel="noreferrer noopener">{title}</a></figcaption>
	</figure>
{:else if audio}
	<div data-testid={testid} class={['ap-embed', 'ap-embed-card', 'ap-embed-audiocard', className]}>
		<a class="ap-embed-title ap-embed-audiotitle" href={url} download={title} target="_blank" rel="noreferrer noopener" title={`Download ${title}`}>{title}</a>
		<AudioPlayer src={audio} preload="none" label={title} />
	</div>
{:else if image}
	<figure data-testid={testid} class={['ap-embed', 'ap-embed-figure', og.image?.animated && 'ap-embed-animated', className]}>
		<a data-viewer-src={viewer?.src} data-viewer-title={viewer?.title} data-viewer-alt={viewer?.alt} data-viewer-detail={viewer?.detail} data-viewer-width={viewer?.width} data-viewer-height={viewer?.height}
			href={url} class="ap-embed-imagelink" target="_blank" rel="noreferrer noopener" aria-haspopup={onview ? 'dialog' : undefined} title={onview ? `View ${title}` : undefined}
			onclick={(event) => { if (onview && plainClick(event)) { event.preventDefault(); onview(event); } }}>
			{#if og.image?.animated}<AnimatedImage class="ap-embed-media" src={image} alt={og.image.alt} {paused} loading="lazy" style={ogRatio(og.image)} />
			{:else}<img class="ap-embed-media" src={image} alt={og.image?.alt || ''} loading="lazy" style={ogRatio(og.image)} />{/if}</a>
		{#if og.image?.animated}
			<!-- After the link, not in it (a button can't be), over the picture's corner. -->
			<button type="button" class="ap-embed-playtoggle" aria-label={paused ? `Play ${title}` : `Pause ${title}`} title={paused ? 'Play' : 'Pause'} onclick={() => (paused = !paused)} data-testid="animation-toggle">
				{#if paused}<Play size={12} aria-hidden="true" />{:else}<Pause size={12} aria-hidden="true" />{/if}<span aria-hidden="true">GIF</span>
			</button>
		{/if}
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
	<a href={url} download={title} target="_blank" rel="noreferrer noopener" data-testid={fileTestid} class={['ap-embed', 'ap-embed-card', 'ap-embed-file', fileClass]}
		aria-haspopup={onpreview ? 'dialog' : undefined} title={onpreview ? `Preview ${title}` : undefined}
		onclick={(event) => { if (onpreview && plainClick(event)) { event.preventDefault(); onpreview(event); } }}>
		{@render glyph()}
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			{#if og.description || detail}<span class="ap-embed-detail">{og.description || detail}</span>{/if}
		</span>
	</a>
{/snippet}
