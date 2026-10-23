<script module lang="ts">
	const TESTIDS = { row: 'notice' };
</script>

<script lang="ts">
	import type { Notice } from '$lib/protocol/client';
	import Message from '$lib/design/components/Message.svelte';
	import type { MessageHandlers } from '$lib/design/components/types';
	import { decorateCode } from '$lib/ui/copy-code';
	import { noticeView } from '$lib/ui/message-view';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';

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

	const on: MessageHandlers = {
		openRoom: (roomId) => onopenroom(roomId),
		openProfile: openProfileFrom,
		code: decorateCode
	};
</script>

<Message view={noticeView(notice)} {on} testids={TESTIDS} />
