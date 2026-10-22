<script lang="ts">
	import DesignEmbedFallback from '$lib/design/components/EmbedFallback.svelte';
	import { safeLink } from '$lib/protocol/embeds';
	import type { Embed } from '$lib/protocol/types';

	/** An embed this client can't render: its kind, and the link or text it carries (§3.5). */
	let { embed }: { embed: Embed } = $props();
</script>

<DesignEmbedFallback kind={embed.kind} url={safeLink(embed.url)} text={typeof embed.text === 'string' ? embed.text : undefined} />
