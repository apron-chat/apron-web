<script lang="ts">
	import { untrack } from 'svelte';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
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
	 * Open, it is a history entry of its own (`page.state.doc`, marked with when it opened), so Back closes it.
	 */
	let view = $derived(docViewer.view);
	/** The history entry opening it pushed, which closing it leaves; 0 for none. */
	let entry = 0;
	/** The last entry's mark: each open's is later, so two opens in one millisecond (or a stopped clock) differ. */
	let marked = 0;

	$effect(() => {
		if (!docViewer.open) return;
		untrack(() => {
			if (entry) return;
			const mark = (marked = Math.max(Date.now(), marked + 1));
			try {
				pushState('', { ...page.state, doc: mark });
				entry = mark;
			} catch {
				// The router isn't started yet (in development): it just isn't an entry Back leaves.
			}
		});
	});

	// Back (or anything else that leaves its entry) closes it.
	$effect(() => {
		const here = page.state.doc;
		untrack(() => {
			if (entry && here !== entry) {
				entry = 0;
				docViewer.open = false;
			}
		});
	});

	/** It closed, whichever way: off its entry, if it is still on it, and focus back on its card. */
	function closed(): void {
		if (entry) {
			const onEntry = page.state.doc === entry;
			entry = 0;
			if (onEntry) history.back();
		}
		docViewer.closed();
	}
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
	<DocViewer bind:open={docViewer.open} title={view.title} detail={view.detail} href={view.url} {status} failed={Boolean(doc && 'error' in doc)} onclose={closed} testid="doc-viewer">
		<div class="ap-msg-text ap-msg-markdown" data-testid="doc-viewer-text" use:highlightCode={html}>{@html html}</div>
	</DocViewer>
{/if}
