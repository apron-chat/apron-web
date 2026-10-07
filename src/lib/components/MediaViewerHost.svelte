<script lang="ts">
	import MediaViewer from '$lib/design/components/MediaViewer.svelte';
	import { mediaViewer } from '$lib/ui/media-viewer.svelte';

	/** The one image viewer, mounted once outside the timeline; image embeds open it (`mediaViewer.show`). */
</script>

<MediaViewer bind:open={mediaViewer.open} items={mediaViewer.items} bind:index={mediaViewer.index} onclose={() => mediaViewer.closed()} />
