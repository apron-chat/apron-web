<script lang="ts">
	import type { MediaItem } from './types';

	interface Props {
		/** Shown full screen while true; bindable, and set false however it closes (Escape, Close, a click beside the image). */
		open?: boolean;
		/** The images to page through, such as every image in the open room, oldest first. */
		items: MediaItem[];
		/** The one shown; bindable, and moved by ← and → and the arrow buttons. */
		index?: number;
		/** It closed, whichever way: put focus back on what opened it. */
		onclose?: () => void;
	}
	let { open = $bindable(false), items, index = $bindable(0), onclose }: Props = $props();

	let dialog = $state<HTMLDialogElement | undefined>();
	let closeButton = $state<HTMLButtonElement | undefined>();
	const uid = $props.id();
	let item = $derived(items[Math.min(Math.max(index, 0), items.length - 1)]);
	let many = $derived(items.length > 1);

	$effect(() => {
		if (!dialog) return;
		if (open && item && !dialog.open) {
			dialog.showModal();
			closeButton?.focus();
		} else if ((!open || !item) && dialog.open) dialog.close();
	});

	function closed(): void {
		open = false;
		onclose?.();
	}

	function step(by: number): void {
		const next = index + by;
		if (next >= 0 && next < items.length) index = next;
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowLeft') step(-1);
		else if (event.key === 'ArrowRight') step(1);
		else return;
		event.preventDefault();
	}

	/** Pressing beside the image, on the ground around it, closes, as a photo viewer does. */
	let pressedGround = false;
	function ground(target: EventTarget | null): boolean {
		return target instanceof HTMLElement && (target === dialog || target.classList.contains('ap-viewer-stage'));
	}
	function click(event: MouseEvent): void {
		if (pressedGround && ground(event.target)) dialog?.close();
		pressedGround = false;
	}
</script>

<dialog bind:this={dialog} class="ap-viewer" aria-labelledby={`${uid}-title`} onclose={closed} onkeydown={keydown} onpointerdown={(event) => (pressedGround = ground(event.target))} onclick={click}>
	{#if item}
		<header class="ap-viewer-bar">
			<div class="ap-viewer-text">
				<h2 class="ap-viewer-title" id={`${uid}-title`}>{item.title}</h2>
				{#if item.detail}<p class="ap-viewer-detail">{item.detail}</p>{/if}
			</div>
			{#if many}<span class="ap-viewer-count" aria-live="polite">{index + 1} of {items.length}</span>{/if}
			{#if item.href}
				<a class="ap-viewer-btn" href={item.href} target="_blank" rel="noreferrer noopener" aria-label="Open original in a new tab" title="Open original">
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
				</a>
			{/if}
			<button bind:this={closeButton} class="ap-viewer-btn" type="button" aria-label="Close" title="Close" onclick={() => dialog?.close()}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
			</button>
		</header>
		<div class="ap-viewer-stage">
			{#key item.src}<img class="ap-viewer-media" src={item.src} alt={item.alt ?? ''} width={item.width} height={item.height} />{/key}
			{#if many}
				<button class="ap-viewer-btn ap-viewer-nav ap-viewer-prev" type="button" aria-label="Previous image" title="Previous (←)" disabled={index === 0} onclick={() => step(-1)}>
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
				</button>
				<button class="ap-viewer-btn ap-viewer-nav ap-viewer-next" type="button" aria-label="Next image" title="Next (→)" disabled={index === items.length - 1} onclick={() => step(1)}>
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
				</button>
			{/if}
		</div>
	{/if}
</dialog>
