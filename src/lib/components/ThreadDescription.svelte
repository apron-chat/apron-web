<script lang="ts">
	import Description from '$lib/design/components/ThreadDescription.svelte';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { highlightCode } from '$lib/ui/highlight';

	/**
	 * A room's or thread's `description` (PROTOCOL.md §3.4), pinned under the
	 * header as the design system's ThreadDescription: CommonMark, rendered and sanitized
	 * as a message body is, with its mentions and room links. It previews three
	 * lines, and its × puts it away (`ondismiss`).
	 */
	let { description, thread, onopenroom, ondismiss }: { description: string; thread: boolean; onopenroom: (roomId: string) => void; ondismiss: () => void } = $props();
	let html = $derived(renderMarkdown(description, directory.resolve, directory.resolveRoom, undefined, directory.resolveEmoji, directory.resolveImage));

	function click(event: MouseEvent): void {
		const roomLink = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-room-id]');
		if (roomLink?.dataset.roomId) onopenroom(roomLink.dataset.roomId);
		else openProfileFrom(event.target);
	}
</script>

<Description label={thread ? 'Thread description' : 'Room description'} {ondismiss}>
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div data-testid="pane-description" onclick={click} use:highlightCode={html}>{@html html}</div>
</Description>
