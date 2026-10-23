<script lang="ts">
	import { fromAction } from 'svelte/attachments';
	import DesignEmbedStream from '$lib/design/components/EmbedStream.svelte';
	import { readStream, sameOriginMedia } from '$lib/protocol/embeds';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import type { Embed } from '$lib/protocol/types';
	import { directory } from '$lib/ui/directory.svelte';
	import { highlightCode } from '$lib/ui/highlight';
	import { renderTerminal } from '$lib/ui/terminal';

	const RECONNECT_MS = 2000;

	/**
	 * Live text (capability `embed:stream`, §4.8.5): while the embed carries `url`
	 * the text grows as `GET url` streams it, and a reconnect replaces what was
	 * shown; once a snapshot carries `text` instead, it is finished. Streams
	 * load only from the chat server's origin. `terminal` text is shown as a
	 * terminal would: colors, and progress lines that overwrite themselves.
	 */
	let { embed }: { embed: Embed } = $props();
	let url = $derived(sameOriginMedia(embed.url, directory.origin));
	let format = $derived(embed.format === 'terminal' || embed.format === 'markdown' ? embed.format : 'plain');
	let streamed = $state('');
	let ended = $state(false);
	let live = $derived(Boolean(url) && !ended && embed.text === undefined);
	let text = $derived(embed.text !== undefined ? String(embed.text) : streamed);
	let terminal = $derived(format === 'terminal' ? renderTerminal(text) : []);
	/** Highlights the Markdown's fenced code blocks as they arrive. */
	const highlight = fromAction(highlightCode, () => text);

	$effect(() => {
		const source = url;
		streamed = '';
		ended = false;
		if (!source) return;
		const controller = new AbortController();
		let retry: ReturnType<typeof setTimeout> | undefined;
		const read = (): void => {
			readStream(source, (next) => (streamed = next), controller.signal)
				.then(() => (ended = true))
				.catch(() => {
					// The stream may not have started yet, or the connection dropped: try again
					// until the snapshot finishing it arrives and removes the url.
					if (!controller.signal.aborted) retry = setTimeout(read, RECONNECT_MS);
				});
		};
		read();
		return () => {
			controller.abort();
			if (retry) clearTimeout(retry);
		};
	});
</script>

{#snippet body()}{#if format === 'markdown'}{@html renderMarkdown(text)}{:else}{#each terminal as span, index (index)}{#if span.className || span.style}<span class={span.className || undefined} style={span.style || undefined}>{span.text}</span>{:else}{span.text}{/if}{/each}{/if}{/snippet}

<DesignEmbedStream kind="stream" {url} done={!live} title={embed.title} {format} {text} status={embed.text !== undefined ? 'Finished' : url ? 'Ended' : 'Unavailable'}
	children={format === 'plain' ? undefined : body} attach={format === 'markdown' ? highlight : undefined} data-testid="stream-embed" />
