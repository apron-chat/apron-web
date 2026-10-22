<script lang="ts">
	import DesignEmbedCard from '$lib/design/components/EmbedCard.svelte';
	import { safeLink } from '$lib/protocol/embeds';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { loadableOg } from './og';

	/** A preview built only from the embed's `og` (§4.8.1): site, title, description, and an image the chat server hosts. */
	let { embed }: { embed: Embed } = $props();
</script>

<DesignEmbedCard kind={embed.kind} url={safeLink(embed.url)} title={embed.title} og={loadableOg(embed.og, directory.origin)} />
