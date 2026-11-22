<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import type { MediaItem } from './types';
	import ViewerDialog from './ViewerDialog.svelte';
	import { clampZoom, maxScale, TAP_ZOOM, UNZOOMED, zoomAt, type Frame, type Zoom } from './zoom';

	/**
	 * An image full screen, paged through with ← and → and the arrow buttons. It zooms in place: two fingers pinch it
	 * (or Ctrl and the wheel, as a trackpad's pinch is), a double tap or click zooms in where it lands and back out,
	 * and zoomed, one finger or the mouse drags it about (or the wheel), never past an edge it could fill the screen
	 * with. A click beside it closes the viewer, only while it isn't zoomed; another image, or a resize, shows it whole.
	 */

	interface Props {
		/** Shown full screen while true and there is an image to show; bindable, and set false however it closes (Escape, Close, a click beside the image). */
		open?: boolean;
		/** The images to page through, such as every image in the open room, oldest first. */
		items: MediaItem[];
		/** The one shown; bindable, and moved by ← and → and the arrow buttons. */
		index?: number;
		/** It closed, whichever way: put focus back on what opened it. */
		onclose?: () => void;
		/** Classes for its `<dialog>`, added to its own. */
		class?: ClassValue;
	}
	let { open = $bindable(false), items, index = $bindable(0), onclose, class: className }: Props = $props();

	let item = $derived(items[Math.min(Math.max(index, 0), items.length - 1)]);
	let many = $derived(items.length > 1);

	/** How the image is drawn: zoomed and moved, or whole. */
	let zoom = $state.raw<Zoom>(UNZOOMED);
	let zoomed = $derived(zoom.scale > 1);
	/** Eased to its next zoom (a double tap's), rather than following a finger. */
	let easing = $state(false);
	let stage = $state<HTMLElement | undefined>();
	let media = $state<HTMLImageElement | undefined>();

	/** Each image, and each open, starts whole. */
	$effect(() => {
		void item?.src;
		void open;
		zoom = UNZOOMED;
		easing = false;
	});

	/** Where the image sits in its stage, and where the stage is on screen: read when a gesture starts, not as it moves. */
	interface Geometry { frame: Frame; max: number; left: number; top: number }
	function measure(): Geometry | undefined {
		if (!stage || !media || !media.offsetWidth) return undefined;
		const box = stage.getBoundingClientRect();
		const frame = {
			cx: media.offsetLeft + media.offsetWidth / 2,
			cy: media.offsetTop + media.offsetHeight / 2,
			w: media.offsetWidth,
			h: media.offsetHeight,
			width: stage.clientWidth,
			height: stage.clientHeight
		};
		return { frame, max: maxScale(frame, media.naturalWidth), left: box.left + stage.clientLeft, top: box.top + stage.clientTop };
	}

	/** The pointers down on the stage, where each is in it; and the gesture they make. */
	const pointers = new Map<number, { x: number; y: number }>();
	let geometry: Geometry | undefined;
	/** Where the gesture's first pointer went down, and whether on the image; `moved` once it is more than a tap. */
	let start: { x: number; y: number; onImage: boolean } | undefined;
	let moved = false;
	/** The last tap, for a second one soon after and near it to make a double tap. */
	let lastTap: { time: number; x: number; y: number } | undefined;

	function at(event: { clientX: number; clientY: number }, where: Geometry): { x: number; y: number } {
		return { x: event.clientX - where.left, y: event.clientY - where.top };
	}

	function pointerdown(event: PointerEvent): void {
		if ((event.pointerType === 'mouse' && event.button !== 0) || (event.target as Element | null)?.closest('button, a')) return;
		if (!pointers.size) geometry = measure();
		if (!geometry) return;
		const point = at(event, geometry);
		pointers.set(event.pointerId, point);
		easing = false;
		try {
			stage?.setPointerCapture(event.pointerId);
		} catch {
			// Not a pointer the page knows (as in a test): its events still come.
		}
		if (pointers.size === 1) {
			start = { ...point, onImage: event.target === media };
			moved = false;
		} else moved = true;
	}

	function pointermove(event: PointerEvent): void {
		const before = pointers.get(event.pointerId);
		if (!before || !geometry) return;
		const point = at(event, geometry);
		if (pointers.size >= 2) {
			const [a, b] = [...pointers.values()];
			pointers.set(event.pointerId, point);
			const [c, d] = [...pointers.values()];
			const spread = Math.hypot(b.x - a.x, b.y - a.y);
			if (!spread) return;
			// Pinched about where the fingers were, then moved as far as they moved together.
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
			const next = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
			zoom = zoomAt(zoom, geometry.frame, geometry.max, mid.x, mid.y, zoom.scale * (Math.hypot(d.x - c.x, d.y - c.y) / spread), next.x - mid.x, next.y - mid.y);
			return;
		}
		pointers.set(event.pointerId, point);
		if (start && Math.hypot(point.x - start.x, point.y - start.y) >= 8) moved = true;
		if (zoomed && moved) zoom = clampZoom({ scale: zoom.scale, x: zoom.x + point.x - before.x, y: zoom.y + point.y - before.y }, geometry.frame, geometry.max);
	}

	function pointerup(event: PointerEvent): void {
		const point = pointers.get(event.pointerId);
		if (!point || !pointers.delete(event.pointerId) || pointers.size) return;
		if (moved || !start || !geometry || (!start.onImage && !zoomed)) {
			lastTap = undefined;
			return;
		}
		const now = event.timeStamp;
		if (lastTap && now - lastTap.time < 350 && Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < 30) {
			lastTap = undefined;
			easing = true;
			zoom = zoomed ? UNZOOMED : zoomAt(zoom, geometry.frame, geometry.max, point.x, point.y, TAP_ZOOM);
		} else lastTap = { time: now, ...point };
	}

	function pointercancel(event: PointerEvent): void {
		pointers.delete(event.pointerId);
		moved = true;
	}

	/** Ctrl and the wheel (a trackpad's pinch) zooms about the pointer; zoomed, the wheel alone moves it. Not passive: it takes the page's zoom and scroll. */
	function wheel(event: WheelEvent): void {
		if (!event.ctrlKey && !zoomed) return;
		const where = measure();
		if (!where) return;
		event.preventDefault();
		easing = false;
		const unit = event.deltaMode === 1 ? 16 : 1;
		if (event.ctrlKey) {
			const point = at(event, where);
			zoom = zoomAt(zoom, where.frame, where.max, point.x, point.y, zoom.scale * Math.exp((-event.deltaY * unit) / 100));
		} else zoom = clampZoom({ scale: zoom.scale, x: zoom.x - event.deltaX * unit, y: zoom.y - event.deltaY * unit }, where.frame, where.max);
	}

	$effect(() => {
		const shown = stage;
		if (!shown) return;
		shown.addEventListener('wheel', wheel, { passive: false });
		return () => shown.removeEventListener('wheel', wheel);
	});

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
</script>

<svelte:window onresize={() => (zoom = UNZOOMED)} />

<ViewerDialog bind:open={() => open && Boolean(item), (value) => (open = value)} title={item?.title ?? ''} detail={item?.detail} {onclose} onkeydown={keydown} class={className}>
	{#snippet actions()}
		{#if many}<span class="ap-viewer-count" aria-live="polite">{index + 1} of {items.length}</span>{/if}
		{#if item?.href}
			<a class="ap-viewer-btn" href={item.href} target="_blank" rel="noreferrer noopener" aria-label="Open original in a new tab" title="Open original">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
			</a>
		{/if}
	{/snippet}
	{#if item}
		<!-- The ground around the image: a click there closes it, while the image isn't zoomed. It takes the touches that
		     pinch and drag the image, wherever they start: a pointer's gestures, as zooming is; from the keyboard, the
		     arrows page and the browser's own zoom zooms. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class={['ap-viewer-stage', zoomed && 'ap-viewer-zoomed']} data-viewer-ground={zoomed ? undefined : ''} bind:this={stage}
			onpointerdown={pointerdown} onpointermove={pointermove} onpointerup={pointerup} onpointercancel={pointercancel}>
			{#key item.src}<img bind:this={media} class={['ap-viewer-media', easing && 'ap-viewer-media-ease']} src={item.src} alt={item.alt ?? ''} width={item.width} height={item.height} draggable="false"
				style:transform={zoomed ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` : undefined} ontransitionend={() => (easing = false)} />{/key}
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
</ViewerDialog>
