<script lang="ts">
	import DesignEmbedHtml from '$lib/design/components/EmbedHtml.svelte';
	import { canSanitize, sanitizeHtml } from '$lib/protocol/sanitize';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import EmbedFallback from './EmbedFallback.svelte';

	/**
	 * Server-relayed HTML (§4.8), inserted only after the sanitizer, every link opening in a new tab like the rest of
	 * the chat's, and its media only from where images may load from (`directory.imageGate`).
	 */
	let { embed }: { embed: Embed } = $props();
	let html = $derived(typeof embed.html === 'string' && canSanitize ? sanitizeHtml(embed.html, 'embed', directory.imageGate) : undefined);
</script>

{#if html !== undefined}
	<DesignEmbedHtml kind="html" {html} />
{:else}
	<EmbedFallback {embed} />
{/if}
