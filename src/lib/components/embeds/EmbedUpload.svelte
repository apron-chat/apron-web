<script lang="ts">
	import DesignEmbedUpload from '$lib/design/components/EmbedUpload.svelte';
	import type { MessageUpload } from '$lib/design/components/types';
	import { safeLink } from '$lib/protocol/embeds';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { mediaViewer } from '$lib/ui/media-viewer.svelte';
	import { loadableOg } from './og';

	/**
	 * A file someone uploaded (capability `embed:upload`, §4.8.4). Pending while
	 * `url` is absent — with progress on the sender's side — then drawn from
	 * `og`: a video player, an audio player, an image, or else a file card.
	 * A plain click on an image opens it full screen; `detail` (who sent it,
	 * and when) goes under its name there. Other clicks keep the link's own
	 * behavior: a new tab or window.
	 */
	let { embed, upload, detail }: { embed: Embed; upload?: MessageUpload; detail?: string } = $props();
	let url = $derived(safeLink(embed.url));
	let og = $derived(loadableOg(embed.og, directory.origin, directory.mediaOrigins));
	let title = $derived(embed.title || og.title || 'File');
	/** An image's size as sent, until the server's `og` arrives with the finished upload. */
	let size = $derived(upload?.width && upload.height ? `${upload.width} × ${upload.height}` : undefined);
	/** What the viewer reads from the image's link (`mediaItemOf`). */
	let viewer = $derived({ src: og.image?.url || undefined, title, alt: og.image?.alt || undefined, detail, width: og.image?.width, height: og.image?.height });
</script>

<DesignEmbedUpload kind="upload" {url} title={embed.title} {og} progress={upload?.progress} failed={upload?.failed} detail={url ? undefined : size}
	{viewer} onview={(event) => mediaViewer.show(event.currentTarget as HTMLElement)} />
