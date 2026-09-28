<script lang="ts">
	import DOMPurify from 'dompurify';
	import type { Embed } from '$lib/protocol/types';
	import EmbedFallback from './EmbedFallback.svelte';

	/** Server-relayed HTML (§4.6), inserted only after the allowlist sanitizer. */
	let { embed }: { embed: Embed } = $props();
	let html = $derived(typeof embed.html === 'string' && DOMPurify.isSupported ? clean(embed.html) : undefined);

	/** Sanitized, with every link opening in a new tab like the rest of the chat's. */
	function clean(source: string): string {
		const body = DOMPurify.sanitize(source, { FORBID_TAGS: ['style', 'form', 'input', 'button'], FORBID_ATTR: ['style'], RETURN_DOM: true }) as HTMLElement;
		for (const link of body.querySelectorAll('a[href]')) {
			link.setAttribute('target', '_blank');
			link.setAttribute('rel', 'noreferrer noopener');
		}
		return body.innerHTML;
	}
</script>

{#if html !== undefined}
	<div class="ap-embed ap-embed-html">{@html html}</div>
{:else}
	<EmbedFallback {embed} />
{/if}
