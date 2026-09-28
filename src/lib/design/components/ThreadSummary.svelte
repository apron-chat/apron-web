<script lang="ts">
	import type { Snippet } from 'svelte';
	/** The thread room's `intro_message`, pinned under the header: rendered + sanitized Markdown as `children`, or plain `summary`. */
	interface Props {
		summary?: string;
		children?: Snippet;
	}
	let { summary, children }: Props = $props();
</script>

<section class="ap-summary" aria-label="Thread summary">
	<span class="ap-summary-label">Summary</span>
	<div class="ap-summary-text ap-msg-text">{#if children}{@render children()}{:else}<p>{summary}</p>{/if}</div>
</section>
