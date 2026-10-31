<script lang="ts">
	import { serverLook, type ChatClient } from '$lib/protocol/client';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { withoutBidiOverrides } from '$lib/protocol/plain-text';
	import { backendHost, connectionStateOf, statusLabel } from '$lib/ui/connection';
	import { preferencesOpener } from '$lib/ui/preferences.svelte';
	import { directory } from '$lib/ui/directory.svelte';
	import { NARROW_MAX } from '$lib/ui/breakpoints';
	import { placePicker } from '$lib/ui/emoji';
	import { serverPane } from '$lib/ui/server-pane.svelte';
	import type { SessionView } from '$lib/ui/session.svelte';
	import ServerCard from '$lib/design/components/ServerCard.svelte';

	/**
	 * The server you're connected to, from the rooms list's head: the design system's ServerCard, with how it shows
	 * itself (§3.1), how the connection stands, who you are there (and the way to your profile), its address to
	 * copy, and Connect to another server… and Disconnect. Fixed to the viewport so the sidebar never clips it: under
	 * the head on wide screens, a bottom sheet on narrow ones.
	 */
	interface Props {
		client: ChatClient;
		session: SessionView;
		/** Connect to another server…: the connect screen; none where the page can't leave this one (an export read, the preview). */
		onnewserver?: () => void;
		/** Disconnect: the connection to this one closes; none where New server… is none. */
		ondisconnect?: () => void;
	}
	let { client, session, onnewserver, ondisconnect }: Props = $props();

	const WIDTH = 344;
	/** Between the pane and the head, and the pane and the viewport's edge. */
	const GAP = 4;

	let box = $state<HTMLDivElement | undefined>();
	let measured = $state(0);
	/** Bumped on scroll and resize, so the pane follows the head. */
	let reflowed = $state(0);

	let anchor = $derived(serverPane.anchor);
	let placement = $derived.by(() => {
		void reflowed;
		if (!anchor) return undefined;
		const box = anchor.getBoundingClientRect();
		const placed = placePicker(box, { width: innerWidth, height: innerHeight }, { width: WIDTH, height: measured || 240, rtl: getComputedStyle(anchor).direction === 'rtl' });
		if (placed.mode !== 'popover') return placed;
		// Under the head, its edge where the head's button starts, clear of the head's rule.
		const head = anchor.closest('.ap-shell-sidehead')?.getBoundingClientRect() ?? box;
		const left = Math.max(GAP, Math.min(box.left, innerWidth - WIDTH - GAP));
		return { ...placed, top: head.bottom + GAP, left };
	});
	let look = $derived(serverLook(session.server, client.url));
	let name = $derived(look.title ?? (backendHost(client.url) || client.url));
	/** Its `description` (§3.1): CommonMark, sanitized as a message is. */
	let description = $derived(look.description ? renderMarkdown(look.description, directory.resolve, directory.resolveRoom, undefined, directory.resolveEmoji, directory.mediaGate) : '');
	let you = $derived(session.you);
	/** How the connection stands, and the dot's tone: green connected, amber on its way, red offline. */
	let connection = $derived.by(() => {
		const state = connectionStateOf(session.snapshot);
		const tone: 'ok' | 'warn' | 'danger' = state === 'connected' ? 'ok' : state === 'offline' ? 'danger' : 'warn';
		return { label: statusLabel(session.snapshot, session.stalled), tone };
	});
	let shownYou = $derived(you ? { name: you.name ? withoutBidiOverrides(you.name) : `@${you.user_id}`, guest: !session.passkeySession } : undefined);
	let protocol = $derived(typeof session.server?.apron === 'number' ? `Apron ${session.server.apron}` : undefined);
	/** The address was just copied: its button says so a moment. */
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyAddress(): Promise<void> {
		try {
			await navigator.clipboard.writeText(client.url);
			copied = true;
			clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => (copied = false), 1500);
		} catch {
			copied = false;
		}
	}

	/** Edit profile: Preferences, at your profile. */
	function editProfile(): void {
		serverPane.close();
		preferencesOpener.open('profile');
	}

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
			// The sheet's dimmed page closes it on its own click, so the press reaches nothing under it.
			if (path.some((target) => target instanceof Element && target.classList.contains('ap-popover-scrim'))) return;
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
		{connection}
		you={shownYou}
		onprofile={shownYou ? editProfile : undefined}
		{protocol}
		oncopyaddress={copyAddress}
		{copied}
		onnewserver={onnewserver && (() => { serverPane.close(); onnewserver(); })}
		ondisconnect={ondisconnect && (() => { serverPane.close(); ondisconnect(); })}
		onclose={() => serverPane.close()}
		testid="server-pane"
		bind:element={box}
		bind:offsetHeight={measured}
		onkeydown={keydown}
		onfocusout={focusout}
	/>
{/if}

{#snippet descriptionBody()}{@html description}{/snippet}
