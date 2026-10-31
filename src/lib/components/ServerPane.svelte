<script lang="ts">
	import { serverLook, type ChatClient } from '$lib/protocol/client';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { withoutBidiOverrides } from '$lib/protocol/plain-text';
	import { backendHost, statusLabel } from '$lib/ui/connection';
	import { directory } from '$lib/ui/directory.svelte';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { placePicker } from '$lib/ui/emoji';
	import { serverPane } from '$lib/ui/server-pane.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import ServerCard from '$lib/design/components/ServerCard.svelte';

	/**
	 * The server you're connected to, from the rooms list's head: the design system's ServerCard, with how it shows
	 * itself (§3.1), how the connection stands, who you are there, and New server… and Disconnect. Fixed to the
	 * viewport so the sidebar never clips it: beside the head on wide screens, a bottom sheet on narrow ones.
	 */
	interface Props {
		client: ChatClient;
		session: SessionView;
		/** New server…: the connect screen, for another server; none where the page can't leave this one (an export read, the preview). */
		onnewserver?: () => void;
		/** Disconnect: the connection to this one closes; none where New server… is none. */
		ondisconnect?: () => void;
	}
	let { client, session, onnewserver, ondisconnect }: Props = $props();

	const WIDTH = 320;

	let box = $state<HTMLDivElement | undefined>();
	let measured = $state(0);
	/** Bumped on scroll and resize, so the pane follows the head. */
	let reflowed = $state(0);

	let anchor = $derived(serverPane.anchor);
	let placement = $derived.by(() => {
		void reflowed;
		if (!anchor) return undefined;
		return placePicker(anchor.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, { width: WIDTH, height: measured || 240, rtl: getComputedStyle(anchor).direction === 'rtl' });
	});

	let look = $derived(serverLook(session.server, client.url));
	let name = $derived(look.title ?? (backendHost(client.url) || client.url));
	/** Its `description` (§3.1): CommonMark, sanitized as a message is. */
	let description = $derived(look.description ? renderMarkdown(look.description, directory.resolve, directory.resolveRoom, undefined, directory.resolveEmoji, directory.mediaGate) : '');
	let you = $derived(session.you);
	let details = $derived([
		{ label: 'Connection', value: statusLabel(session.snapshot, session.stalled) },
		{ label: 'You', value: you ? `${you.name ? `${withoutBidiOverrides(you.name)} ` : ''}@${you.user_id}${session.passkeySession ? '' : ' · guest'}` : 'Not signed in' },
		...(typeof session.server?.apron === 'number' ? [{ label: 'Protocol', value: `Apron ${session.server.apron}` }] : [])
	]);

	// Focus moves in when it opens, so Escape and Tab work from the keyboard.
	$effect(() => {
		if (anchor && box) box.focus({ preventScroll: true });
	});

	// While open: follow the head, and close on a press outside.
	$effect(() => {
		const current = anchor;
		if (!current) return;
		const outside = (event: PointerEvent) => {
			const path = event.composedPath();
			if ((box && path.includes(box)) || path.includes(current)) return;
			serverPane.close();
		};
		const reflow = () => {
			if (!current.isConnected || (innerWidth < NARROW_MAX) !== (placement?.mode === 'sheet')) {
				serverPane.close();
				return;
			}
			reflowed++;
		};
		document.addEventListener('pointerdown', outside, true);
		addEventListener('resize', reflow);
		addEventListener('scroll', reflow, true);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			removeEventListener('resize', reflow);
			removeEventListener('scroll', reflow, true);
		};
	});

	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		serverPane.close(true);
	}

	/** Tabbing out of the pane closes it, as a press outside does. */
	function focusout(event: FocusEvent): void {
		const next = event.relatedTarget;
		if (!(next instanceof Node) || !box || box.contains(next) || anchor?.contains(next)) return;
		serverPane.close();
	}
</script>

{#if anchor && placement}
	<ServerCard
		mode={placement.mode}
		top={placement.mode === 'popover' ? placement.top : undefined}
		left={placement.mode === 'popover' ? placement.left : undefined}
		width={placement.mode === 'popover' ? WIDTH : undefined}
		{name}
		address={client.url}
		avatar={directory.avatarGate.src(look.avatar)}
		description={description ? descriptionBody : undefined}
		{details}
		onnewserver={onnewserver && (() => { serverPane.close(); onnewserver(); })}
		ondisconnect={ondisconnect && (() => { serverPane.close(); ondisconnect(); })}
		testid="server-pane"
		bind:element={box}
		bind:offsetHeight={measured}
		onkeydown={keydown}
		onfocusout={focusout}
	/>
{/if}

{#snippet descriptionBody()}{@html description}{/snippet}
