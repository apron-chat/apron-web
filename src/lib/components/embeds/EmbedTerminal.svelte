<script lang="ts">
	import DesignEmbedTerminal from '$lib/design/components/EmbedTerminal.svelte';
	import { sameOriginMedia } from '$lib/protocol/embeds';
	import { followLiveText, liveTextDecoder } from '$lib/protocol/live-text';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { closedTerminals, terminalKey } from '$lib/ui/terminal-closed.svelte';
	import { TerminalFeed } from '$lib/ui/terminal-feed';
	import { terminalPageUrl } from '$lib/ui/terminal-page';
	import { terminalViewer, type TerminalView } from '$lib/ui/terminal-viewer.svelte';
	import type { TerminalScreen } from '$lib/ui/terminal-screen';
	import { loadTerminalScreen } from '$lib/ui/xterm';

	/**
	 * A `terminal` embed (capability `embed:terminal`, §4.8.6), drawn as a
	 * terminal would show it, on a `TerminalScreen` (loaded with xterm.js once
	 * one is shown). While the embed has no `output` it is live: `GET url` is
	 * decoded and written to its `TerminalFeed` as it arrives, and a reconnect
	 * starts the feed afresh with the new response. Once a snapshot carries
	 * `output`, that is shown, from a fresh terminal. Live text loads only from
	 * the chat server's origin. The feed keeps the text, so Expand can show it
	 * full screen (`terminalViewer`) on a second screen, live too, from this
	 * one read of `url`. Copy in its header copies what its screen shows, as
	 * plain text, and while it has a `url`, Open shows the stream on
	 * terminal.apron.chat, in a new tab. Close in its header hides its screen
	 * and stops reading `url` (and closes its viewer), until Show, which reads
	 * it afresh; it stays closed when drawn again, and after a reload (`closedTerminals`).
	 */
	let { embed }: { embed: Embed } = $props();
	let url = $derived(sameOriginMedia(embed.url, directory.origin));
	let page = $derived(terminalPageUrl(url, embed.title));
	let output = $derived(typeof embed.output === 'string' ? embed.output : undefined);
	const feed = new TerminalFeed();
	let key = $derived(terminalKey(directory.server, directory.account, embed));
	/** Closed without a key (`terminalKey`): kept here only. */
	let closedHere = $state(false);
	let closed = $derived(key ? closedTerminals.has(key) : closedHere);
	/** `GET url` ended, or was refused for good: the output did, and the snapshot with it is on its way. */
	let ended = $state(false);
	let live = $derived(output === undefined && Boolean(url) && !ended && !closed);
	/** Without `output` or `url`, its write has not started (§4.8.5); a `url` from elsewhere is not loaded. */
	let status = $derived(output !== undefined ? 'Finished' : url ? 'Ended' : embed.url === undefined ? 'Waiting to stream…' : 'Unavailable');

	/** What the viewer shows of it, read as it changes. */
	const view: TerminalView = {
		get title() {
			return embed.title;
		},
		get live() {
			return live;
		},
		get status() {
			return status;
		},
		feed
	};

	/** The screen in the message, once it has loaded: what Copy copies. */
	let shown: TerminalScreen | undefined;

	/** Copies what the screen shows, as plain text: its rows as drawn, without the control functions that drew them. */
	async function copy(): Promise<boolean> {
		const text = shown?.text();
		if (!text) return false;
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}

	/** Hides its screen and its viewer, and stops reading `url`. */
	function close(): void {
		if (key) closedTerminals.close(key);
		else closedHere = true;
	}

	/** Shows it again, reading `url` afresh while it is live. */
	function reopen(): void {
		if (key) closedTerminals.show(key);
		closedHere = false;
	}

	function attach(node: HTMLElement): () => void {
		let detach: (() => void) | undefined;
		let gone = false;
		void loadTerminalScreen().then(({ TerminalScreen }) => {
			if (gone) return;
			const screen = new TerminalScreen(node);
			const unfeed = feed.attach(screen);
			shown = screen;
			detach = () => {
				if (shown === screen) shown = undefined;
				unfeed();
				screen.dispose();
			};
		});
		return () => {
			gone = true;
			detach?.();
		};
	}

	$effect(() => {
		if (closed) {
			// Nothing shows it: keep none of its text, and read none.
			feed.reset();
			return;
		}
		if (output !== undefined) {
			feed.show(output);
			return;
		}
		const source = url;
		ended = false;
		if (!source) return;
		const controller = new AbortController();
		// Decoded here, as the server decodes `output`: xterm would skip invalid bytes that `output` shows as U+FFFD.
		let decoder = liveTextDecoder();
		void followLiveText(source, {
			start: () => {
				decoder = liveTextDecoder();
				feed.reset();
			},
			chunk: (bytes) => feed.write(decoder.decode(bytes, { stream: true })),
			end: () => {
				feed.write(decoder.decode());
				ended = true;
			}
		}, controller.signal);
		return () => controller.abort();
	});

	// Gone or closed (here or in another tab), its viewer goes too: nothing would feed it.
	$effect(() => () => terminalViewer.forget(view));
	$effect(() => {
		if (closed) terminalViewer.forget(view);
	});
</script>

<DesignEmbedTerminal kind="terminal" {url} done={!live} title={embed.title} {status} {page} {attach} oncopy={copy} onexpand={(button) => terminalViewer.show(view, button)} {closed} onclose={close} onshow={reopen} testid="terminal-embed" />
