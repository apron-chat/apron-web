<script lang="ts" module>
	/** The sizes Smaller and Larger text step through: 100% to 200%. */
	export const DOC_ZOOMS = [1, 1.25, 1.5, 1.75, 2];
</script>

<script lang="ts">
	import AArrowDown from '@lucide/svelte/icons/a-arrow-down';
	import AArrowUp from '@lucide/svelte/icons/a-arrow-up';
	import { tick, type Snippet } from 'svelte';
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
	 * End) scroll it; Tab goes on to Download and Close, and Escape closes it, as does a click beside the page.
	 * Smaller and Larger text in the bar (and − and + from the keyboard) draw the page from 100% to 200%, its column
	 * with it, so a line holds as many words while there is room; the place being read stays in view.
	 */
	interface Props {
		/** Shown full screen while true; bindable, and set false however it closes (Escape, Close, a click beside the page). */
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
		/**
		 * How large the page is drawn, one of `DOC_ZOOMS`; bindable, set by Smaller and Larger text. Unset, the
		 * stylesheet's: 125% wider than a phone, 100% on one.
		 */
		zoom?: number;
		/** The document, already rendered and sanitized. */
		children?: Snippet;
		/** It closed, whichever way: put focus back on what opened it. */
		onclose?: () => void;
		/** Classes for its `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<dialog>`. */
		testid?: string;
	}
	let { open = $bindable(false), title, detail, href: rawHref, status, failed = false, zoom = $bindable(), children, onclose, class: className, testid }: Props = $props();

	const href = $derived(safeHttp(rawHref));
	let stage = $state<HTMLElement | undefined>();

	/** The stylesheet's size, until one is chosen: 125% wider than a phone (its `min-width: 561px`), 100% on one. */
	const unset = globalThis.matchMedia?.('(min-width: 561px)').matches ? 1.25 : 1;
	let at = $derived(DOC_ZOOMS.reduce((near, each) => (Math.abs(each - (zoom ?? unset)) < Math.abs(near - (zoom ?? unset)) ? each : near)));

	/** One size smaller or larger, keeping the place being read where it was on the page. */
	async function step(by: number): Promise<void> {
		const next = DOC_ZOOMS[DOC_ZOOMS.indexOf(at) + by];
		if (next === undefined) return;
		const place = stage && stage.scrollHeight ? stage.scrollTop / stage.scrollHeight : 0;
		zoom = next;
		await tick();
		if (stage) stage.scrollTop = place * stage.scrollHeight;
	}

	/** − and + (or =) size the page; with Ctrl or ⌘ they stay the browser's own zoom. */
	function keydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey || status) return;
		const by = event.key === '+' || event.key === '=' ? 1 : event.key === '-' ? -1 : 0;
		if (!by) return;
		event.preventDefault();
		void step(by);
	}
</script>

{#snippet downloadIcon()}<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3" /><path d="m7 10 5 5 5-5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /></svg>{/snippet}

<ViewerDialog bind:open {title} {detail} {onclose} onkeydown={keydown} class={['ap-docviewer', className]} {testid}>
	{#snippet actions()}
		{#if !status}
			<button class="ap-viewer-btn" type="button" aria-label="Smaller text" title="Smaller text (−)" disabled={at === DOC_ZOOMS[0]} onclick={() => step(-1)}><AArrowDown size={18} aria-hidden="true" /></button>
			<button class="ap-viewer-btn" type="button" aria-label="Larger text" title="Larger text (+)" disabled={at === DOC_ZOOMS[DOC_ZOOMS.length - 1]} onclick={() => step(1)}><AArrowUp size={18} aria-hidden="true" /></button>
		{/if}
		{#if href}<a class="ap-viewer-btn" {href} download={title} target="_blank" rel="noreferrer noopener" aria-label={`Download ${title}`} title="Download">{@render downloadIcon()}</a>{/if}
	{/snippet}
	<!-- The document, which has focus once it opens, so Space, the arrows and Page Up and Down scroll it. Named
	     Document: the dialog it is in already says the file's name. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="ap-docviewer-stage" role="region" aria-label="Document" tabindex="0" data-viewer-focus data-viewer-ground bind:this={stage}>
		<p class="ap-sr" role="status">{status ?? 'Loaded'}</p>
		{#if status}
			<div class="ap-docviewer-status" data-viewer-ground>
				<p aria-hidden="true">{status}</p>
				{#if failed && href}<a class="ap-btn ap-btn-quiet ap-docviewer-download" {href} download={title} target="_blank" rel="noreferrer noopener">{@render downloadIcon()}Download</a>{/if}
			</div>
		{:else}
			<article class="ap-docviewer-page" style:zoom={zoom === undefined ? undefined : String(zoom)}>{@render children?.()}</article>
		{/if}
	</div>
</ViewerDialog>
