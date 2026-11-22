<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import type { MediaItem } from './types';
	import ViewerDialog from './ViewerDialog.svelte';
	import { clampZoom, maxScale, TAP_ZOOM, UNZOOMED, zoomAt, type Frame, type Zoom } from './zoom';

	/**
	 * An image full screen, paged through with ← and → and the arrow buttons. It zooms in place: two fingers pinch it
	 * (or a trackpad's pinch, or Ctrl and the wheel), a double tap or click zooms in where it lands and back out, + and
	 * − zoom about the middle and 0 shows it whole; and zoomed, one finger or the mouse drags it about (or the wheel),
	 * never past an edge it could fill the screen with. A click beside it closes the viewer, only while it isn't zoomed;
	 * another image, or a resize, shows it whole.
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
	/** Eased to its next zoom (a double tap's, a key's), rather than following a finger; never where motion is reduced. */
	let easing = $state(false);
	/** Clipped to the stage, and no ground to close on: while zoomed, and while easing back out, still larger than it. */
	let framed = $derived(zoomed || easing);
	let stage = $state<HTMLElement | undefined>();
	let media = $state<HTMLImageElement | undefined>();

	/** Zooms to `next`, eased where motion may be. */
	function ease(next: Zoom): void {
		const changes = next.scale !== zoom.scale || next.x !== zoom.x || next.y !== zoom.y;
		easing = changes && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		zoom = next;
	}

	/** Where the image sits in its stage, and where the stage is on screen: read once for each image and size, not as it moves. */
	interface Geometry { frame: Frame; max: number; left: number; top: number }
	let geometry: Geometry | undefined;
	function measured(): Geometry | undefined {
		if (geometry) return geometry;
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
		return (geometry = { frame, max: maxScale(frame, media.naturalWidth), left: box.left + stage.clientLeft, top: box.top + stage.clientTop });
	}

	/** The pointers down on the stage, where each is in it. */
	const pointers = new Map<number, { x: number; y: number }>();
	/** Where the gesture's first pointer went down, and whether on the image; `moved` once it is more than a tap. */
	let start: { x: number; y: number; onImage: boolean } | undefined;
	let moved = false;
	/** The last tap, for a second one soon after and near it to make a double tap. */
	let lastTap: { time: number; x: number; y: number } | undefined;
	/** The zoom a Safari trackpad pinch (its `gesture` events) started from. */
	let gestureFrom: number | undefined;

	/** Whole again, and nothing kept of what was measured or pressed: for each image, each open and each size. */
	function reset(): void {
		zoom = UNZOOMED;
		easing = false;
		geometry = undefined;
		pointers.clear();
		lastTap = undefined;
		gestureFrom = undefined;
	}

	$effect(() => {
		void item?.src;
		void open;
		reset();
	});

	function at(event: { clientX: number; clientY: number }, where: Geometry): { x: number; y: number } {
		return { x: event.clientX - where.left, y: event.clientY - where.top };
	}

	function pointerdown(event: PointerEvent): void {
		if ((event.pointerType === 'mouse' && event.button !== 0) || (event.target as Element | null)?.closest('button, a')) return;
		// A first finger starts a new gesture: any pointer kept from one whose end went elsewhere (the viewer closed
		// under it) is gone.
		if (event.isPrimary) pointers.clear();
		const where = measured();
		if (!where) return;
		const point = at(event, where);
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
			ease(zoomed ? UNZOOMED : zoomAt(zoom, geometry.frame, geometry.max, point.x, point.y, TAP_ZOOM));
		} else lastTap = { time: now, ...point };
	}

	/** A pointer gone without its `pointerup` here (cancelled, or its capture lost): its gesture is no tap. */
	function pointergone(event: PointerEvent): void {
		if (pointers.delete(event.pointerId)) moved = true;
	}

	/**
	 * Ctrl and the wheel (a trackpad's pinch, in most browsers) zooms about the pointer, a mouse's notch a step at a time;
	 * zoomed, the wheel alone moves it. Not passive: it takes the page's zoom and scroll.
	 */
	function wheel(event: WheelEvent): void {
		if (!event.ctrlKey && !zoomed) return;
		const where = measured();
		if (!where) return;
		event.preventDefault();
		easing = false;
		const unit = event.deltaMode === 1 ? 16 : 1;
		if (event.ctrlKey) {
			const point = at(event, where);
			const by = Math.min(Math.max(-event.deltaY * unit, -25), 25);
			zoom = zoomAt(zoom, where.frame, where.max, point.x, point.y, zoom.scale * Math.exp(by / 100));
		} else zoom = clampZoom({ scale: zoom.scale, x: zoom.x - event.deltaX * unit, y: zoom.y - event.deltaY * unit }, where.frame, where.max);
	}

	/**
	 * A Safari trackpad's pinch, which comes as `gesture` events rather than the wheel: zooms about the pointer, by its
	 * `scale` from where it started. A touch pinch also sends them there, but its pointers zoom it already.
	 */
	function gesture(event: Event & { scale?: number; clientX?: number; clientY?: number }): void {
		event.preventDefault();
		if (event.type === 'gestureend' || pointers.size) {
			gestureFrom = undefined;
			return;
		}
		const where = measured();
		if (!where) return;
		if (event.type === 'gesturestart') gestureFrom = zoom.scale;
		else if (gestureFrom !== undefined && event.scale) {
			const point = at({ clientX: event.clientX ?? where.left + where.frame.cx, clientY: event.clientY ?? where.top + where.frame.cy }, where);
			easing = false;
			zoom = zoomAt(zoom, where.frame, where.max, point.x, point.y, gestureFrom * event.scale);
		}
	}

	$effect(() => {
		const shown = stage;
		if (!shown) return;
		const types = ['gesturestart', 'gesturechange', 'gestureend'];
		shown.addEventListener('wheel', wheel, { passive: false });
		for (const type of types) shown.addEventListener(type, gesture);
		return () => {
			shown.removeEventListener('wheel', wheel);
			for (const type of types) shown.removeEventListener(type, gesture);
		};
	});

	/** + and − (or =) zoom about the middle of the screen, 0 shows it whole; with Ctrl or ⌘ they stay the browser's own. */
	function zoomByKey(key: string): boolean {
		const by = key === '+' || key === '=' ? 1.5 : key === '-' ? 1 / 1.5 : key === '0' ? 0 : undefined;
		const where = by === undefined ? undefined : measured();
		if (!where) return false;
		ease(by ? zoomAt(zoom, where.frame, where.max, where.frame.width / 2, where.frame.height / 2, zoom.scale * by) : UNZOOMED);
		return true;
	}

	function step(by: number): void {
		const next = index + by;
		if (next >= 0 && next < items.length) index = next;
	}

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowLeft') step(-1);
		else if (event.key === 'ArrowRight') step(1);
		else if (event.ctrlKey || event.metaKey || event.altKey || !zoomByKey(event.key)) return;
		event.preventDefault();
	}
</script>

<svelte:window onresize={reset} />

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
		     pinch and drag the image, wherever they start: a pointer's gestures; from the keyboard, the arrows page and
		     + and − zoom. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class={['ap-viewer-stage', framed && 'ap-viewer-zoomed']} data-viewer-ground={framed ? undefined : ''} bind:this={stage}
			onpointerdown={pointerdown} onpointermove={pointermove} onpointerup={pointerup} onpointercancel={pointergone} onlostpointercapture={pointergone}>
			{#key item.src}<img bind:this={media} class={['ap-viewer-media', easing && 'ap-viewer-media-ease']} src={item.src} alt={item.alt ?? ''} width={item.width} height={item.height} draggable="false"
				style:transform={zoomed ? `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` : undefined} onload={() => (geometry = undefined)}
				ontransitionend={() => (easing = false)} ontransitioncancel={() => (easing = false)} />{/key}
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
