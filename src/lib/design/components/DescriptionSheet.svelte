<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { ClassValue } from 'svelte/elements';
	import { fades } from './fades';

	/**
	 * A room's or thread's whole description, over its conversation from under the RoomHeader (in its AppShell pane): read,
	 * as tall as the description, to 80% of the pane, scrolling within past that and faded where it's cut; edited, all 80%,
	 * the editor (`children`, a MarkdownEditor) filling it. The room under it is dimmed, and out of reach (inert) but for
	 * its header, which holds the sheet's buttons (Edit and ×, or Cancel and Save) and the title being edited. A click on
	 * the dimmed room asks to shut it (`onclose`); Escape that nothing in the sheet took, to step back (`onescape`). On a
	 * phone it is the whole pane under the header.
	 *
	 * Read, the description (`children`: rendered Markdown with its own `.ap-msg-text`) is set as a document (`.ap-doc`)
	 * and has focus as it opens, so the keys that scroll a page scroll it.
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
		/** Classes for its `<section>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<section>`. */
		testid?: string;
	}
	let { label, editing = false, children, onclose, onescape, class: className, testid }: Props = $props();

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

	/** Read, the description has focus as it opens. */
	const focused: Attachment<HTMLElement> = (body) => {
		body.focus({ preventScroll: true });
	};
</script>

<!-- The dimmed room is the pointer's way to shut it; Escape is the keyboard's, and the header has ×. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="ap-descsheet-scrim" aria-hidden="true" onclick={onclose}></div>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class={['ap-descsheet', editing && 'ap-descsheet-editing', className]} aria-label={label} data-testid={testid} onkeydown={keydown} {@attach quiets}>
	{#if editing}
		<div class="ap-descsheet-body">{@render children()}</div>
	{:else}
		<!-- The description has focus, so Space, the arrows and Page Up and Down scroll it. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="ap-descsheet-body ap-doc" tabindex="0" {@attach fades()} {@attach focused}>{@render children()}</div>
	{/if}
</section>
