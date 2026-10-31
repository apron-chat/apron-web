<script lang="ts">
	import DesignEmbedTerminal from '$lib/design/components/EmbedTerminal.svelte';
	import { sameOriginMedia } from '$lib/protocol/embeds';
	import { followLiveText, liveTextDecoder } from '$lib/protocol/live-text';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { TerminalFeed } from '$lib/ui/terminal-feed';
	import { terminalViewer, type TerminalView } from '$lib/ui/terminal-viewer.svelte';
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
	 * one read of `url`.
	 */
	let { embed }: { embed: Embed } = $props();
	let url = $derived(sameOriginMedia(embed.url, directory.origin));
	let output = $derived(typeof embed.output === 'string' ? embed.output : undefined);
	const feed = new TerminalFeed();
	/** `GET url` ended: the output did, and the snapshot with it is on its way. */
	let ended = $state(false);
	let live = $derived(output === undefined && Boolean(url) && !ended);
	let status = $derived(output !== undefined ? 'Finished' : url ? 'Ended' : 'Unavailable');

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

	function attach(node: HTMLElement): () => void {
		let detach: (() => void) | undefined;
		let gone = false;
		void loadTerminalScreen().then(({ TerminalScreen }) => {
			if (gone) return;
			const screen = new TerminalScreen(node);
			const unfeed = feed.attach(screen);
			detach = () => {
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

	// Gone, its viewer goes too: nothing would feed it.
	$effect(() => () => terminalViewer.forget(view));
</script>

<DesignEmbedTerminal kind="terminal" {url} done={!live} title={embed.title} {status} {attach} onexpand={(button) => terminalViewer.show(view, button)} testid="terminal-embed" />
