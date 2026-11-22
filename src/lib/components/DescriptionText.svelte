<script lang="ts">
	import { directory } from '$lib/ui/directory.svelte';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { highlightCode } from '$lib/ui/highlight';

	/**
	 * A room's or thread's `description` (PROTOCOL.md §3.4) as it reads, in its first lines under the header
	 * (ThreadDescription) and whole over the pane (DescriptionSheet) alike: CommonMark, rendered and sanitized as a message
	 * body is, its code highlighted, with its mentions (a click shows who) and its room links (a click opens the room).
	 */
	let { description, onopenroom, testid }: { description: string; onopenroom: (roomId: string) => void; testid?: string } = $props();
	let html = $derived(directory.markdown(description));

	function click(event: MouseEvent): void {
		const roomLink = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-room-id]');
		if (roomLink?.dataset.roomId) onopenroom(roomLink.dataset.roomId);
		else openProfileFrom(event.target);
	}
</script>

<!-- Its mentions and room links are buttons and links, which take the keyboard themselves. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="ap-msg-text ap-msg-markdown" data-testid={testid} onclick={click} use:highlightCode={html}>{@html html}</div>
