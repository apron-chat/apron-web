<script lang="ts">
	import DocViewer from '$lib/design/components/DocViewer.svelte';
	import { renderMarkdown } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import { readDoc, type DocText } from '$lib/ui/doc-text';
	import { docViewer } from '$lib/ui/doc-viewer.svelte';
	import { highlightCode } from '$lib/ui/highlight';

	/**
	 * The one document viewer, mounted by the page once it first opens, outside the timeline; a Markdown file's card opens it
	 * (`docViewer.show`). It reads the file (`readDoc`) and renders it as a message body is: CommonMark, sanitized, its
	 * code highlighted, and its pictures loading only where the timeline's would (`directory.mediaGate`). A file isn't a
	 * message, so a `@name` or `#room` in it stays text. Where the file can't be read, it says so and offers Download.
	 */
	let view = $derived(docViewer.view);
	/** What was read, and from where: a read for a file no longer shown is dropped. */
	let read = $state.raw<{ url: string; doc?: DocText }>();

	$effect(() => {
		const url = view?.url;
		if (!url) return;
		const controller = new AbortController();
		read = { url };
		void readDoc(url, controller.signal).then((doc) => {
			if (!controller.signal.aborted) read = { url, doc };
		});
		return () => controller.abort();
	});

	let doc = $derived(read && read.url === view?.url ? read.doc : undefined);
	let text = $derived(doc && 'text' in doc ? doc.text : undefined);
	let html = $derived(text?.trim() ? renderMarkdown(text, undefined, undefined, undefined, undefined, directory.mediaGate) : '');
	let status = $derived(
		!doc ? 'Loading…'
		: 'error' in doc ? (doc.error === 'large' ? 'This file is too large to preview.' : 'This file can’t be previewed here.')
		: !html ? 'This file is empty.'
		: undefined
	);
</script>

{#if view}
	<DocViewer bind:open={docViewer.open} title={view.title} detail={view.detail} href={view.url} {status} failed={Boolean(doc && 'error' in doc)} onclose={() => docViewer.closed()} testid="doc-viewer">
		<div class="ap-msg-text ap-msg-markdown" data-testid="doc-viewer-text" use:highlightCode={html}>{@html html}</div>
	</DocViewer>
{/if}
