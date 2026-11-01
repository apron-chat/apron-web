<script lang="ts">
	import type { MessageUpload } from '$lib/design/components/types';
	import { shownEmbed } from '$lib/protocol/plain-text';
	import type { Embed } from '$lib/protocol/types';
	import EmbedCard from './EmbedCard.svelte';
	import EmbedFallback from './EmbedFallback.svelte';
	import EmbedFrame from './EmbedFrame.svelte';
	import EmbedHtml from './EmbedHtml.svelte';
	import EmbedTerminal from './EmbedTerminal.svelte';
	import EmbedUpload from './EmbedUpload.svelte';

	/**
	 * One entry of `body.embeds` (§4.8), rendered by its `kind`. An
	 * unknown kind renders from `og`, else as the fallback card — never an error.
	 * An `append` embed draws nothing here: the body shows its text.
	 * Its text shows without bidi embeddings and overrides (§3.5.2, `shownEmbed`).
	 */
	/** `detail`: who sent it and when, for an image shown full screen. */
	let { embed: sent, upload, detail }: { embed: Embed; upload?: MessageUpload; detail?: string } = $props();
	let embed = $derived(shownEmbed(sent));
</script>

{#if embed.kind === 'upload'}
	<EmbedUpload {embed} {upload} {detail} />
{:else if embed.kind === 'terminal'}
	<EmbedTerminal {embed} />
{:else if embed.kind === 'append'}
	<!-- No card: its text continues the message's body (§4.8.5, `messageView`). -->
{:else if embed.kind === 'iframe'}
	<EmbedFrame {embed} />
{:else if embed.kind === 'html'}
	<EmbedHtml {embed} />
{:else if embed.og && typeof embed.og === 'object'}
	<EmbedCard {embed} />
{:else}
	<EmbedFallback {embed} />
{/if}
