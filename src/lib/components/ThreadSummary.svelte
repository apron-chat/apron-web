<script lang="ts">
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { highlightCode } from '$lib/ui/highlight';

	/**
	 * A thread's `description` (PROTOCOL.md §3.4), pinned at the top of the
	 * thread as the design system's summary: CommonMark, rendered and sanitized
	 * as a message body is, with its mentions and room links.
	 */
	let { description, onopenroom }: { description: string; onopenroom: (roomId: string) => void } = $props();
	let html = $derived(renderMarkdown(description, directory.resolve, directory.resolveRoom));

	function click(event: MouseEvent): void {
		const roomLink = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-room-id]');
		if (roomLink?.dataset.roomId) onopenroom(roomLink.dataset.roomId);
		else openProfileFrom(event.target);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
<section class="ap-summary" aria-label="Thread summary" data-testid="thread-summary" onclick={click}>
	<span class="ap-summary-label">Summary</span>
	<div class="ap-summary-text ap-msg-text" use:highlightCode={html}>{@html html}</div>
</section>
