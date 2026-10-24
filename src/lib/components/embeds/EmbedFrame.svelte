<script lang="ts">
	import DesignEmbedFrame from '$lib/design/components/EmbedFrame.svelte';
	import { safeLink } from '$lib/protocol/embeds';
	import type { Embed } from '$lib/protocol/types';

	/**
	 * A backend-served live view (§4.8): sandboxed with scripts but never
	 * same-origin, no referrer, `height` clamped to iframe-max-h. It stays a
	 * paused placeholder until the viewer loads it.
	 */
	let { embed }: { embed: Embed } = $props();
	let live = $state(false);
</script>

<DesignEmbedFrame kind="iframe" url={safeLink(embed.url)} title={embed.title} height={typeof embed.height === 'number' ? embed.height : undefined} {live} onactivate={() => (live = true)} />
