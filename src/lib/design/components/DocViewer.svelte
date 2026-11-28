<script lang="ts" module>
	import * as icons from './Icons.svelte';
	/** The sizes Smaller and Larger text step through: 100% to 200%. */
	export const DOC_ZOOMS = [1, 1.25, 1.5, 1.75, 2];
</script>

<script lang="ts">
	import AArrowDown from '@lucide/svelte/icons/a-arrow-down';
	import AArrowUp from '@lucide/svelte/icons/a-arrow-up';
	import WrapText from '@lucide/svelte/icons/wrap-text';
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
	 * with it, so a line holds as many words while there is room; the place being read stays in view. A document of
	 * lines, such as plain text, can have Wrap lines in the bar too (and W): off, a line keeps to one line however long,
	 * the page widening to the longest and the viewer scrolling sideways; on, a long line wraps to the page.
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
		/**
		 * Whether a long line wraps to the page; bindable, set by Wrap lines. Unset, there is no Wrap lines: the
		 * document wraps as its own styles say. Off, the page is as wide as its longest line, which the consumer's
		 * styles keep to one line (`.ap-docviewer-page-wide`).
		 */
		wrap?: boolean;
		/** The document, already rendered and sanitized. */
		children?: Snippet;
		/** It closed, whichever way: put focus back on what opened it. */
		onclose?: () => void;
		/** Classes for its `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<dialog>`. */
		testid?: string;
	}
	let { open = $bindable(false), title, detail, href: rawHref, status, failed = false, zoom = $bindable(), wrap = $bindable(), children, onclose, class: className, testid }: Props = $props();

	const href = $derived(safeHttp(rawHref));
	let stage = $state<HTMLElement | undefined>();

	/** The stylesheet's size, until one is chosen: 125% wider than a phone (its `min-width: 561px`), 100% on one. */
	const unset = globalThis.matchMedia?.('(min-width: 561px)').matches ? 1.25 : 1;
	let at = $derived(DOC_ZOOMS.reduce((near, each) => (Math.abs(each - (zoom ?? unset)) < Math.abs(near - (zoom ?? unset)) ? each : near)));

	/** Makes `change` to the page, keeping the place being read where it was on it, however its height changes. */
	async function keepingPlace(change: () => void): Promise<void> {
		const place = stage && stage.scrollHeight ? stage.scrollTop / stage.scrollHeight : 0;
		change();
		await tick();
		if (stage) stage.scrollTop = place * stage.scrollHeight;
	}

	/** One size smaller or larger. */
	function step(by: number): void {
		const next = DOC_ZOOMS[DOC_ZOOMS.indexOf(at) + by];
		if (next !== undefined) void keepingPlace(() => (zoom = next));
	}

	/** Long lines wrapped, or each on one line. */
	function toggleWrap(): void {
		if (wrap !== undefined) void keepingPlace(() => (wrap = !wrap));
	}

	/** − and + (or =) size the page, and W wraps its lines where it can; with Ctrl or ⌘ they stay the browser's own. */
	function keydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey || status) return;
		if ((event.key === 'w' || event.key === 'W') && wrap !== undefined) {
			event.preventDefault();
			toggleWrap();
			return;
		}
		const by = event.key === '+' || event.key === '=' ? 1 : event.key === '-' ? -1 : 0;
		if (!by) return;
		event.preventDefault();
		step(by);
	}
</script>

<ViewerDialog bind:open {title} {detail} {onclose} onkeydown={keydown} class={['ap-docviewer', className]} {testid}>
	{#snippet actions()}
		{#if !status}
			{#if wrap !== undefined}<button class="ap-viewer-btn" type="button" aria-label="Wrap lines" aria-pressed={wrap} title={wrap ? 'Wrap lines: on (W)' : 'Wrap lines: off (W)'} onclick={toggleWrap}><WrapText size={18} aria-hidden="true" /></button>{/if}
			<button class="ap-viewer-btn" type="button" aria-label="Smaller text" title="Smaller text (−)" disabled={at === DOC_ZOOMS[0]} onclick={() => step(-1)}><AArrowDown size={18} aria-hidden="true" /></button>
			<button class="ap-viewer-btn" type="button" aria-label="Larger text" title="Larger text (+)" disabled={at === DOC_ZOOMS[DOC_ZOOMS.length - 1]} onclick={() => step(1)}><AArrowUp size={18} aria-hidden="true" /></button>
		{/if}
		{#if href}<a class="ap-viewer-btn" {href} download={title} target="_blank" rel="noreferrer noopener" aria-label={`Download ${title}`} title="Download">{@render icons.download()}</a>{/if}
	{/snippet}
	<!-- The document, which has focus once it opens, so Space, the arrows and Page Up and Down scroll it. Named
	     Document: the dialog it is in already says the file's name. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="ap-docviewer-stage" role="region" aria-label="Document" tabindex="0" data-viewer-focus data-viewer-ground bind:this={stage}>
		<p class="ap-sr" role="status">{status ?? 'Loaded'}</p>
		{#if status}
			<div class="ap-docviewer-status" data-viewer-ground>
				<p aria-hidden="true">{status}</p>
				{#if failed && href}<a class="ap-btn ap-btn-quiet ap-docviewer-download" {href} download={title} target="_blank" rel="noreferrer noopener">{@render icons.download()}Download</a>{/if}
			</div>
		{:else}
			<article class={['ap-docviewer-page', 'ap-doc', wrap === false && 'ap-docviewer-page-wide']} style:zoom={zoom === undefined ? undefined : String(zoom)}>{@render children?.()}</article>
		{/if}
	</div>
</ViewerDialog>
