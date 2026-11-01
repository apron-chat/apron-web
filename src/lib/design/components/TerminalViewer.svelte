<script lang="ts">
	import type { ClassValue } from 'svelte/elements';

	/**
	 * A terminal embed (§4.8.6) full screen, over everything, on the MediaViewer's dark ground: its title, Live or
	 * what it says once finished, and Close, over the whole screen at a readable size. The screen is the consumer's,
	 * through `attach`, given a box in the stage (its parent), which scrolls when the screen is larger than it: never
	 * the page. Without `attach`, `text` shows as plain preformatted text.
	 */
	interface Props {
		/** Shown full screen while true; bindable, and set false however it closes (Escape, Close). */
		open?: boolean;
		/** The embed's title; Terminal without one. */
		title?: string;
		/** Still being written: a Live badge. */
		live?: boolean;
		/** What it says once it isn't live, in place of Finished (such as Ended). */
		status?: string;
		/** Draws the screen in the box it is given, such as an xterm.js terminal, while it is open. */
		attach?: (screen: HTMLElement) => void | (() => void);
		/** The screen's plain text, without `attach`. */
		text?: string;
		/** It closed, whichever way: put focus back on what opened it. */
		onclose?: () => void;
		/** Classes for its `<dialog>`, added to its own. */
		class?: ClassValue;
		/** A `data-testid` for its `<dialog>`. */
		testid?: string;
	}
	let { open = $bindable(false), title, live = false, status, attach, text, onclose, class: className, testid }: Props = $props();

	let dialog = $state<HTMLDialogElement | undefined>();
	let closeButton = $state<HTMLButtonElement | undefined>();
	const uid = $props.id();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			closeButton?.focus();
		} else if (!open && dialog.open) dialog.close();
	});

	function closed(): void {
		open = false;
		onclose?.();
	}

	/** Escape closes it, here rather than by the browser's cancel, which may be skipped for a dialog opened without a press. */
	function keydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		dialog?.close();
	}
</script>

<!-- Its title names it. -->
<dialog bind:this={dialog} class={['ap-viewer', 'ap-termviewer', className]} aria-labelledby={`${uid}-title`} data-testid={testid} onclose={closed} onkeydown={keydown}>
	{#if open}
		<header class="ap-viewer-bar">
			<div class="ap-viewer-text">
				<h2 class="ap-viewer-title" id={`${uid}-title`} dir="auto">{title || 'Terminal'}</h2>
			</div>
			{#if live}<span class="ap-embed-livebadge" role="status"><i aria-hidden="true"></i>Live</span>
			{:else}<span class="ap-viewer-detail">{status || 'Finished'}</span>{/if}
			<button bind:this={closeButton} class="ap-viewer-btn" type="button" aria-label="Close" title="Close" onclick={() => dialog?.close()}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
			</button>
		</header>
		<div class="ap-termviewer-stage">
			{#if attach}<div class="ap-termviewer-screen" dir="ltr" {@attach attach}></div>
			{:else}<pre class="ap-termviewer-screen ap-termviewer-text" dir="ltr">{text || ''}</pre>{/if}
		</div>
	{/if}
</dialog>
