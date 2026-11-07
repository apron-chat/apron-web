<script lang="ts">
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import { highlightCode } from '$lib/ui/highlight';

	/**
	 * The full panel's Preview: the draft as its message will show once sent, rendered and sanitized as a message body
	 * is (`message-view.ts`), with its mentions, room links and code. Loaded on demand with the panel.
	 */
	let { text }: { text: string } = $props();
	let html = $derived(text.trim() ? renderMarkdown(text, directory.resolve, directory.resolveRoom, directory.resolveLink, directory.resolveEmoji, directory.mediaGate) : '');
</script>

{#if html}
	<div class="ap-msg-text ap-msg-markdown" data-testid="draft-preview" use:highlightCode={html}>{@html html}</div>
{:else}
	<p class="ap-composer-rendered-empty" data-testid="draft-preview">Nothing to preview yet.</p>
{/if}
