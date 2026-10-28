<script module lang="ts">
	const TESTIDS = { row: 'notice' };
</script>

<script lang="ts">
	import type { Notice } from '$lib/protocol/client';
	import { systemScope } from '$lib/protocol/types';
	import Message from '$lib/design/components/Message.svelte';
	import type { MessageHandlers } from '$lib/design/components/types';
	import { signInQrDialog } from '$lib/components/lazy';
	import { decorateCode } from '$lib/ui/copy-code';
	import { noticeView } from '$lib/ui/message-view';
	import { openProfileFrom } from '$lib/ui/profile-card.svelte';
	import { offerSignInQr } from '$lib/ui/sign-in-qr';

	/**
	 * A transient notice (PROTOCOL.md §3.5, Appendix A.1): a `message` without
	 * `message_id`, such as a `~private` command reply, or a local one such as a
	 * command's error. Nobody else got it unless its sender says so (a
	 * server-wide notice for a room you haven't joined), it is not stored, and
	 * it is gone on reload. The design system's Message draws it as a scoped
	 * notice: a card titled by its sender, dashed when it was only for you; code
	 * blocks in it get a Copy button, and in one only for you, sign-in links get
	 * Show QR code.
	 */
	let { notice, onopenroom }: { notice: Notice; onopenroom: (roomId: string) => void } = $props();

	/** The sign-in link whose QR code is showing, until its dialog closes. */
	let qrHref = $state<string | undefined>();

	const on: MessageHandlers = {
		openRoom: (roomId) => onopenroom(roomId),
		openProfile: openProfileFrom,
		code: (body, copy) => {
			if (systemScope(notice.from.user_id) === 'private') offerSignInQr(body, (href) => (qrHref = href));
			return decorateCode(body, copy);
		}
	};
</script>

<Message view={noticeView(notice)} {on} testids={TESTIDS} />
{#if qrHref && signInQrDialog.component}
	{@const SignInQrDialog = signInQrDialog.component}
	<SignInQrDialog href={qrHref} onclose={() => (qrHref = undefined)} />
{/if}
