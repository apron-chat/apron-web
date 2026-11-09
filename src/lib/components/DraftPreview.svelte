<script lang="ts">
	import { directory } from '$lib/ui/directory.svelte';
	import { highlightCode } from '$lib/ui/highlight';

	/**
	 * Preview, of the composer's full panel or a description: the text as it will show, rendered and sanitized as a
	 * message body is (`message-view.ts`), with its mentions, room links and code. Loaded on demand.
	 */
	interface Props {
		text: string;
		/** Links as a message draws them (chips for rooms and messages); false for a description, which draws them plain. */
		links?: boolean;
	}
	let { text, links = true }: Props = $props();
	let html = $derived(directory.markdown(text, links));
</script>

{#if html}
	<div class="ap-msg-text ap-msg-markdown" data-testid="draft-preview" use:highlightCode={html}>{@html html}</div>
{:else}
	<p class="ap-composer-rendered-empty" data-testid="draft-preview">Nothing to preview yet.</p>
{/if}
