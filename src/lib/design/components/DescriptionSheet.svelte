<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { ClassValue } from 'svelte/elements';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import TextAlignStart from '@lucide/svelte/icons/text-align-start';
	import { fades } from './fades';

	/**
	 * A room's or thread's whole description, over its conversation from under the RoomHeader (in its AppShell pane): read,
	 * as tall as the description, to 80% of the pane, scrolling within past that and faded where it's cut; edited, all 80%,
	 * the editor (`children`, a MarkdownEditor) filling it. The room under it is dimmed, and out of reach (inert) but for
	 * its header, which holds the sheet's buttons (Edit and ×, or Cancel and Save) and the title being edited. A click on
	 * the dimmed room asks to shut it (`onclose`); Escape that nothing in the sheet took, to step back (`onescape`). Edited
	 * on a phone, it is the whole pane under the header.
	 *
	 * Read, the description (`children`: rendered Markdown with its own `.ap-msg-text`) is set as a document (`.ap-doc`) in
	 * the column the conversation's text starts on, with the description icon in its top left corner as its first lines
	 * have it. It has focus as it opens, so the keys that scroll a page scroll it: with the focus ring if the keyboard
	 * opened it, without if the pointer did. Longer than its first lines under the header show (the ThreadDescription whose
	 * Read all opens it), Show less at its foot folds it back into them (`onfold`); as short as they are, it has no foot,
	 * as they'd show the same. Whether it is longer is told as it's measured, and as that changes (`onoutgrow`).
	 */
	interface Props {
		/** Names the region: "Room description" or "Thread description". */
		label: string;
		/** Being edited: as tall as it may be, the editor filling it. */
		editing?: boolean;
		children: Snippet;
		/** A click on the dimmed room: shut it, or ask to while it is edited. */
		onclose: () => void;
		/** Escape that nothing in it took: a step back (from editing to reading, say); shutting it, without. */
		onescape?: () => void;
		/** Read, and longer than its first lines: Show less at its foot folds it back into them under the header. */
		onfold?: (event: MouseEvent) => void;
		/** Read: whether it is longer than its first lines under the header show, as measured and as that changes. */
		onoutgrow?: (outgrows: boolean) => void;
		/** Read, opened by the pointer: no focus ring as it takes focus (the browser draws one after a click on what takes none). */
		pointer?: boolean;
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<section>`. */
		testid?: string;
	}
	let { label, editing = false, children, onclose, onescape, onfold, onoutgrow, pointer = false, class: className, testid }: Props = $props();

	/** Read, longer than its first lines under the header show: then it folds back into them. */
	let outgrows = $state(false);

	/** Escape that no picker or field inside took (they prevent its default): a step back. */
	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		event.preventDefault();
		(onescape ?? onclose)();
	}

	/**
	 * While it shows, what else is in its pane (the timeline, the composer, banners) is out of reach of the keyboard and
	 * screen readers as of the pointer, as under a dialog, and so is what comes into it meanwhile (a banner, the composer
	 * in place of a read-only bar); the header stays, as it holds the sheet's buttons.
	 */
	const quiets: Attachment<HTMLElement> = (sheet) => {
		const pane = sheet.parentElement;
		if (!pane) return;
		const muted = new Set<HTMLElement>();
		const quiet = (each: Element) => {
			if (!(each instanceof HTMLElement) || each === sheet || each.inert || each.matches('.ap-roomhead, .ap-descsheet-scrim')) return;
			each.inert = true;
			muted.add(each);
		};
		for (const each of pane.children) quiet(each);
		const arrivals = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver((changes) => {
			for (const change of changes) for (const node of change.addedNodes) if (node instanceof Element) quiet(node);
		});
		arrivals?.observe(pane, { childList: true });
		return () => {
			arrivals?.disconnect();
			for (const each of muted) each.inert = false;
		};
	};

	/**
	 * Read, the description has focus as it opens; opened by the pointer, without the ring the browser would draw after a
	 * click on what takes no focus (the preview, the name), until it leaves.
	 */
	const focused: Attachment<HTMLElement> = (body) => {
		if (untrack(() => pointer)) body.dataset.pointer = '';
		body.focus({ preventScroll: true });
		const keyed = () => delete body.dataset.pointer;
		body.addEventListener('blur', keyed, { once: true });
		return () => body.removeEventListener('blur', keyed);
	};

	/**
	 * Read, whether the description is taller than its first lines' box (the probe beside it, as tall as theirs: lines and
	 * the bar under them, six lines in a narrow pane), measured as a ResizeObserver reports either, after the browser has
	 * laid the frame out. The description's own height, not its scrolling box's, so Show less coming changes nothing measured.
	 */
	const measures: Attachment<HTMLElement> = (probe) => {
		const body = probe.parentElement?.querySelector<HTMLElement>('.ap-descsheet-body');
		const text = body?.firstElementChild;
		if (!text || typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(() => {
			const now = text.getBoundingClientRect().height > probe.offsetHeight + 1;
			if (now === outgrows) return;
			outgrows = now;
			onoutgrow?.(now);
		});
		observer.observe(text);
		observer.observe(probe);
		return () => observer.disconnect();
	};
</script>

<!-- The dimmed room is the pointer's way to shut it; Escape is the keyboard's, and the header has ×. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="ap-descsheet-scrim" aria-hidden="true" onclick={onclose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class={['ap-descsheet', editing && 'ap-descsheet-editing', !editing && onfold && outgrows && 'ap-descsheet-folds', className]} aria-label={label} data-testid={testid} onkeydown={keydown} {@attach quiets}>
	{#if editing}
		<div class="ap-descsheet-body">{@render children()}</div>
	{:else}
		<!-- The description icon in its corner, as in its first lines': the region's label already says what it is. -->
		<span class="ap-descsheet-icon" title={label}><TextAlignStart size={15} strokeWidth={2} aria-hidden="true" /></span>
		<!-- The description has focus, so Space, the arrows and Page Up and Down scroll it. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="ap-descsheet-body ap-doc" tabindex="0" {@attach fades()} {@attach focused}>{@render children()}</div>
		<span class="ap-descsheet-probe" aria-hidden="true" {@attach measures}></span>
		{#if onfold && outgrows}
			<div class="ap-descsheet-foot">
				<button class="ap-btn ap-btn-sm ap-btn-ghost ap-description-more" type="button" onclick={onfold}>Show less<ChevronUp size={16} strokeWidth={2} aria-hidden="true" /></button>
			</div>
		{/if}
	{/if}
</section>
