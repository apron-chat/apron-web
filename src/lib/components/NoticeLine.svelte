<script lang="ts">
	import type { Notice } from '$lib/protocol/client';
	import { renderMarkdown, renderPlain } from '$lib/protocol/markdown';
	import { systemScope } from '$lib/protocol/types';
	import DesignMessage from '$lib/design/components/Message.svelte';
	import { copyCode } from '$lib/ui/copy-code';
	import { directory } from '$lib/ui/directory.svelte';
	import { highlightCode } from '$lib/ui/highlight';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { idMillis } from '$lib/ui/time';

	/**
	 * A transient notice (PROTOCOL.md §3.5, Appendix A.1): a `message` without
	 * `message_id`, such as a `~private` command reply, or a local one such as a
	 * command's error. Nobody else got it unless its sender says so (a
	 * server-wide notice for a room you haven't joined), it is not stored, and
	 * it is gone on reload. The design system's Message draws it as a scoped
	 * notice: a card titled by its sender, dashed when it was only for you; code
	 * blocks in it get a Copy button.
	 */
	let { notice, onopenroom }: { notice: Notice; onopenroom: (roomId: string) => void } = $props();

	let text = $derived(typeof notice.body?.text === 'string' ? notice.body.text : '');
	let markdown = $derived(notice.body?.format === 'markdown');
	let body = $derived(markdown ? renderMarkdown(text, directory.resolve, directory.resolveRoom) : renderPlain(text, directory.resolve, directory.resolveRoom));

	function click(event: MouseEvent): void {
		const roomLink = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-room-id]');
		if (roomLink?.dataset.roomId) onopenroom(roomLink.dataset.roomId);
		else openProfileFrom(event.target);
	}
</script>

{#snippet noticeText()}
	<div class={['ap-msg-text', !markdown && 'ap-msg-plain']} use:copyCode={body} use:highlightCode={body}>{@html body}</div>
{/snippet}

<DesignMessage
	data-timeline-item="" data-testid="notice" system scope={systemScope(notice.from.user_id) ?? 'private'} sender={notice.from}
	timestamp={idMillis(String(notice.at))} body={noticeText} onclick={click}
/>
