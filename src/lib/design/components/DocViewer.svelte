<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { safeHttp } from './util';
	import ViewerDialog from './ViewerDialog.svelte';

	/**
	 * A document full screen, over everything, on the MediaViewer's dark ground: its title and what it is, Download and
	 * Close, and the document as a page in a readable column, which scrolls inside the viewer, never the page. The
	 * document is the consumer's (`children`), such as rendered Markdown; `status` shows in its place while it loads
	 * or where it can't be shown, with Download under it when it `failed`. A live region there from the start says
	 * each change (why it can't be shown, or Loaded once it can), as one made with its words already in it isn't. The
	 * document has focus once it opens, so the keys that scroll a page (Space, the arrows, Page Up and Down, Home and
	 * End) scroll it; Tab goes on to Download and Close, and Escape closes it.
	 */
	interface Props {
		/** Shown full screen while true; bindable, and set false however it closes (Escape, Close). */
		open?: boolean;
		/** The document's name, such as its file name. */
		title: string;
		/** A line under the title, such as who sent it and when. */
		detail?: string;
		/** The file itself, to download or open in a new tab. */
		href?: string;
		/** Shown in place of the document: while it loads, or why it can't be shown. */
		status?: string;
		/** It can't be shown: Download under `status`. */
		failed?: boolean;
		/** The document, already rendered and sanitized. */
		children?: Snippet;
		/** It closed, whichever way: put focus back on what opened it. */
		onclose?: () => void;
		/** Classes for its `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<dialog>`. */
		testid?: string;
	}
	let { open = $bindable(false), title, detail, href: rawHref, status, failed = false, children, onclose, class: className, testid }: Props = $props();

	const href = $derived(safeHttp(rawHref));
</script>

{#snippet downloadIcon()}<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>{/snippet}

<ViewerDialog bind:open {title} {detail} {onclose} class={['ap-docviewer', className]} {testid}>
	{#snippet actions()}
		{#if href}<a class="ap-viewer-btn" {href} download={title} target="_blank" rel="noreferrer noopener" aria-label={`Download ${title}`} title="Download">{@render downloadIcon()}</a>{/if}
	{/snippet}
	<!-- The document, which has focus once it opens, so Space, the arrows and Page Up and Down scroll it. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="ap-docviewer-stage" role="region" aria-label={title} tabindex="0" data-viewer-focus>
		<p class="ap-sr" role="status">{status ?? 'Loaded'}</p>
		{#if status}
			<div class="ap-docviewer-status">
				<p aria-hidden="true">{status}</p>
				{#if failed && href}<a class="ap-btn ap-btn-quiet ap-docviewer-download" {href} download={title} target="_blank" rel="noreferrer noopener">{@render downloadIcon()}Download</a>{/if}
			</div>
		{:else}
			<article class="ap-docviewer-page">{@render children?.()}</article>
		{/if}
	</div>
</ViewerDialog>
