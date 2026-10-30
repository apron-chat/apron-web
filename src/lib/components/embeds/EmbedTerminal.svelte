<script lang="ts">
	import DesignEmbedTerminal from '$lib/design/components/EmbedTerminal.svelte';
	import { sameOriginMedia } from '$lib/protocol/embeds';
	import { followLiveText, liveTextDecoder } from '$lib/protocol/live-text';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { TerminalScreen } from '$lib/ui/terminal-screen';

	/**
	 * A `terminal` embed (capability `embed:terminal`, §4.8.6), drawn as a
	 * terminal would show it, on a `TerminalScreen` (xterm.js, loaded once one
	 * is shown). While the embed has no `output` it is live: `GET url` is
	 * written to the screen as it arrives, and a reconnect starts the screen
	 * afresh with the new response. Once a snapshot carries `output`, that is
	 * shown, from a fresh terminal. Live text loads only from the chat
	 * server's origin.
	 */
	let { embed }: { embed: Embed } = $props();
	let url = $derived(sameOriginMedia(embed.url, directory.origin));
	let output = $derived(typeof embed.output === 'string' ? embed.output : undefined);
	let screen = $state.raw<TerminalScreen>();
	/** `GET url` ended: the output did, and the snapshot with it is on its way. */
	let ended = $state(false);
	let live = $derived(output === undefined && Boolean(url) && !ended);

	function attach(node: HTMLElement): () => void {
		const created = new TerminalScreen(node);
		screen = created;
		return () => {
			created.dispose();
			if (screen === created) screen = undefined;
		};
	}

	$effect(() => {
		const target = screen;
		if (!target) return;
		if (output !== undefined) {
			target.show(output);
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
				target.reset();
			},
			chunk: (bytes) => target.write(decoder.decode(bytes, { stream: true })),
			end: () => {
				const tail = decoder.decode();
				if (tail) target.write(tail);
				ended = true;
			}
		}, controller.signal);
		return () => controller.abort();
	});
</script>

<DesignEmbedTerminal kind="terminal" {url} done={!live} title={embed.title} status={output !== undefined ? 'Finished' : url ? 'Ended' : 'Unavailable'} {attach} testid="terminal-embed" />
