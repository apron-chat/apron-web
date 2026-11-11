<script lang="ts">
	import MediaViewer from '$lib/design/components/MediaViewer.svelte';
	import { mediaViewer } from '$lib/ui/media-viewer.svelte';
	import { backCloses } from '$lib/ui/viewer.svelte';

	/**
	 * The one image viewer, mounted once outside the timeline; image embeds open it (`mediaViewer.show`). Open, it is a
	 * history entry of its own (`page.state.media`), so Back closes it.
	 */
	const leave = backCloses('media', () => mediaViewer.open, () => (mediaViewer.open = false));

	function closed(): void {
		leave();
		mediaViewer.closed();
	}
</script>

<MediaViewer bind:open={mediaViewer.open} items={mediaViewer.items} bind:index={mediaViewer.index} onclose={closed} />
