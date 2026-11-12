<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ClassValue } from 'svelte/elements';

	/**
	 * What a full-screen viewer is (MediaViewer, DocViewer): a modal `<dialog>` over everything, on a dark ground,
	 * named by its title. A bar (the title, a line under it, the viewer's own `actions`, and Close) over what it shows
	 * (`children`), drawn only while open. Once it opens, focus goes to what it shows where that names a part of
	 * itself for it (`data-viewer-focus`, such as a document to read and scroll), else to Close. Escape or Close closes it,
	 * and so does a click on the ground around what it shows (its bar, and what the viewer marks `data-viewer-ground`,
	 * such as the stage an image or a page sits on), as a photo viewer's does. Both viewers
	 * load on demand, so this does too; TerminalViewer, which the layout draws from the start, keeps a dialog of its
	 * own, as sharing this with it would split it out into one more file to load at startup.
	 */
	interface Props {
		/** Shown full screen while true; bindable, and set false however it closes. */
		open?: boolean;
		title: string;
		/** A line under the title, such as who sent it and when. */
		detail?: string;
		/** The viewer's own part of the bar, between the title and Close: a count, a badge, a link. */
		actions?: Snippet;
		/** What it shows, under the bar. */
		children?: Snippet;
		/** It closed, whichever way: put focus back on what opened it. */
		onclose?: () => void;
		/** Keys besides Escape, which closes it. */
		onkeydown?: (event: KeyboardEvent) => void;
		/** Classes for its `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<dialog>`. */
		testid?: string;
	}
	let { open = $bindable(false), title, detail, actions, children, onclose, onkeydown, class: className, testid }: Props = $props();

	let dialog = $state<HTMLDialogElement | undefined>();
	let closeButton = $state<HTMLButtonElement | undefined>();
	const uid = $props.id();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			(dialog.querySelector<HTMLElement>('[data-viewer-focus]') ?? closeButton)?.focus();
		} else if (!open && dialog.open) dialog.close();
	});

	/**
	 * It closed. The `close` event comes a moment after: shown again meanwhile (Escape, then Enter at once on what opened
	 * it), it never closed, as far as anyone is concerned. Closing it here (Escape, Close) sets `open` false at once, not
	 * when the event comes, so an open in between is a change the dialog sees and shows, whatever it opens on.
	 */
	function closed(): void {
		if (dialog?.open) return;
		open = false;
		onclose?.();
	}

	/**
	 * A click on the ground closes it: one that went down there too, and barely moved, so selecting text from beside a
	 * page doesn't, nor a press on a stage's scrollbar (inside the element, outside its content box). A touch that
	 * scrolls makes no click.
	 */
	let pressed: { x: number; y: number } | undefined;
	function onGround(event: MouseEvent): boolean {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !target.hasAttribute('data-viewer-ground')) return false;
		const box = target.getBoundingClientRect();
		return event.clientX - box.left <= target.clientLeft + target.clientWidth && event.clientY - box.top <= target.clientTop + target.clientHeight;
	}
	function pointerdown(event: PointerEvent): void {
		pressed = event.button === 0 && onGround(event) ? { x: event.clientX, y: event.clientY } : undefined;
	}
	function click(event: MouseEvent): void {
		if (pressed && onGround(event) && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 8) open = false;
		pressed = undefined;
	}

	/** Escape closes it, here rather than by the browser's cancel, which may be skipped for a dialog opened without a press. */
	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			open = false;
		} else onkeydown?.(event);
	}
</script>

<!-- Its title names it. -->
<dialog bind:this={dialog} class={['ap-viewer', className]} aria-labelledby={`${uid}-title`} data-testid={testid} data-viewer-ground onclose={closed} onkeydown={keydown} onpointerdown={pointerdown} onclick={click}>
	{#if open}
		<header class="ap-viewer-bar" data-viewer-ground>
			<div class="ap-viewer-text">
				<h2 class="ap-viewer-title" id={`${uid}-title`} dir="auto">{title}</h2>
				{#if detail}<p class="ap-viewer-detail">{detail}</p>{/if}
			</div>
			{@render actions?.()}
			<button bind:this={closeButton} class="ap-viewer-btn" type="button" aria-label="Close" title="Close" onclick={() => (open = false)}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
			</button>
		</header>
		{@render children?.()}
	{/if}
</dialog>
