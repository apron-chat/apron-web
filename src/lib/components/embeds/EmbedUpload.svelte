<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import type { UploadState } from '$lib/protocol/client';
	import { embedMedia, safeLink } from '$lib/protocol/embeds';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';

	/**
	 * A file someone uploaded (capability `embed:upload`, §4.6.4). Pending while
	 * `url` is absent — with progress on the sender's side — then drawn from
	 * `og`: a video player, an audio player, an image, or else a file card.
	 */
	let { embed, upload }: { embed: Embed; upload?: UploadState } = $props();
	let url = $derived(safeLink(embed.url));
	let og = $derived(embed.og ?? {});
	let title = $derived(embed.title || og.title || 'File');
	let image = $derived(embedMedia(og.image?.url, directory.origin));
	let video = $derived(embedMedia(og.video?.url, directory.origin));
	let audio = $derived(embedMedia(og.audio?.url, directory.origin));
	let percent = $derived(upload?.progress !== undefined ? Math.round(upload.progress * 100) : undefined);
	/** An image's size as sent, until the server's `og` arrives with the finished upload. */
	let size = $derived(upload?.width && upload.height ? `${upload.width} × ${upload.height} · ` : '');

	/** og width and height only reserve the aspect ratio (embed-max-w × embed-max-h clamp the box). */
	function ratio(media: { width?: number; height?: number } | undefined): string | undefined {
		return media?.width && media.height ? `${media.width} / ${media.height}` : undefined;
	}
</script>

{#snippet glyph()}
	<span class="ap-embed-fileglyph">
		<FileIcon size={20} aria-hidden="true" />
	</span>
{/snippet}

{#if !url}
	<div class="ap-embed ap-embed-card ap-embed-pending" role="status" data-testid="upload-pending">
		{@render glyph()}
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			<span class="ap-embed-detail">{upload?.failed ? `Upload failed · ${upload.failed}` : percent !== undefined ? `${size}Uploading · ${percent}%` : `${size}Uploading…`}</span>
		</span>
		{#if percent !== undefined && !upload?.failed}
			<span class="ap-embed-progress" aria-hidden="true"><i style:width="{percent}%"></i></span>
		{/if}
	</div>
{:else if video}
	<figure class="ap-embed ap-embed-figure">
		<!-- svelte-ignore a11y_media_has_caption -->
		<video class="ap-embed-media" src={video} poster={image} controls preload="metadata" style:aspect-ratio={ratio(og.video) ?? ratio(og.image)}></video>
		<figcaption class="ap-embed-caption"><a href={url} download={title} target="_blank" rel="noreferrer noopener">{title}</a></figcaption>
	</figure>
{:else if audio}
	<div class="ap-embed ap-embed-card ap-embed-audiocard">
		<span class="ap-embed-title">{title}</span>
		<audio class="ap-embed-audio" src={audio} controls preload="none"></audio>
	</div>
{:else if image}
	<figure class="ap-embed ap-embed-figure">
		<a href={url} class="ap-embed-imagelink" target="_blank" rel="noreferrer noopener"><img class="ap-embed-media" src={image} alt={og.image?.alt || ''} loading="lazy" style:aspect-ratio={ratio(og.image)} /></a>
		<figcaption class="ap-embed-caption">{title}</figcaption>
	</figure>
{:else}
	<a class="ap-embed ap-embed-card ap-embed-file" href={url} download={title} target="_blank" rel="noreferrer noopener">
		{@render glyph()}
		<span class="ap-embed-cardtext">
			<span class="ap-embed-title">{title}</span>
			{#if og.description}<span class="ap-embed-detail">{og.description}</span>{/if}
		</span>
	</a>
{/if}
