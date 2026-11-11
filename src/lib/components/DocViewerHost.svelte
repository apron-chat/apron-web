<script lang="ts">
	import DocViewer from '$lib/design/components/DocViewer.svelte';
	import { renderDocument } from '$lib/protocol/markdown';
	import { directory } from '$lib/ui/directory.svelte';
	import { headingFor, readDoc, type DocText } from '$lib/ui/doc-text';
	import { docViewer, type DocView } from '$lib/ui/doc-viewer.svelte';
	import { highlightCode } from '$lib/ui/highlight';
	import { backCloses } from '$lib/ui/viewer.svelte';

	/**
	 * The one document viewer, loaded when it first opens (`lazy.ts`) and mounted by the page from then on; a Markdown
	 * file's card opens it (`docViewer.show`). Each open reads the file anew (`readDoc`) and renders it
	 * (`renderDocument`): CommonMark, sanitized, its code highlighted, its pictures loading only where the timeline's
	 * would (`directory.mediaGate`). A link to one of its headings scrolls there. Where the file can't be read, it says
	 * so and offers Download. Open, it is a history entry of its own (`page.state.doc`), so Back closes it.
	 */
	let view = $derived(docViewer.view);
	/** What was read, for the open it was read for: another open, even of the same file, reads anew and shows nothing older. */
	let read = $state.raw<{ view: DocView; doc: DocText }>();

	$effect(() => {
		const shown = view;
		if (!shown) return;
		const controller = new AbortController();
		void readDoc(shown.url, controller.signal).then((doc) => {
			if (!controller.signal.aborted) read = { view: shown, doc };
		});
		return () => {
			controller.abort();
			read = undefined;
		};
	});

	let doc = $derived(read?.view === view ? read?.doc : undefined);
	let text = $derived(doc && 'text' in doc ? doc.text : undefined);
	let html = $derived(text?.trim() ? renderDocument(text, directory.mediaGate) : '');
	let status = $derived(
		!doc ? 'Loading…'
		: 'error' in doc ? (doc.error === 'large' ? 'This file is too large to preview.' : 'This file can’t be previewed here.')
		: !html ? 'This file is empty.'
		: undefined
	);

	/** Back closes it; closing it otherwise goes Back off its entry. */
	const leave = backCloses('doc', () => docViewer.open, () => (docViewer.open = false));

	function closed(): void {
		leave();
		docViewer.closed();
	}

	/** A link to one of its headings (`#install`) scrolls there, rather than to the app's own address with that fragment. */
	function follow(event: MouseEvent): void {
		const link = (event.target as Element | null)?.closest('a[href^="#"]');
		if (!link) return;
		event.preventDefault();
		headingFor(event.currentTarget as HTMLElement, link.getAttribute('href')!.slice(1))?.scrollIntoView({ block: 'start' });
	}
</script>

{#if view}
	<DocViewer bind:open={docViewer.open} title={view.title} detail={view.detail} href={view.url} {status} failed={Boolean(doc && 'error' in doc)} onclose={closed} testid="doc-viewer">
		<!-- Its links are links, which take Enter themselves. -->
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="ap-msg-text ap-msg-markdown" data-testid="doc-viewer-text" onclick={follow} use:highlightCode={html}>{@html html}</div>
	</DocViewer>
{/if}
