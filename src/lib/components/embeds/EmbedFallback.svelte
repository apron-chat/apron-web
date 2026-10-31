<script lang="ts">
	import DesignEmbedFallback from '$lib/design/components/EmbedFallback.svelte';
	import { safeLink } from '$lib/protocol/embeds';
	import type { Embed } from '$lib/protocol/types';

	/** An embed this client can't render, without `og`: its kind, plus its `title` and a link to its `url` if present (§3.5.2). */
	let { embed }: { embed: Embed } = $props();
</script>

<DesignEmbedFallback kind={embed.kind} title={typeof embed.title === 'string' ? embed.title : undefined} url={safeLink(embed.url)} />
