<script lang="ts" module>
	/**
	 * How long an animated image plays by itself before it holds still, in ms: a Play press plays it on until paused.
	 * Five seconds: motion that stops by then needs no way to pause it (WCAG 2.2.2), though each upload's has one.
	 */
	export const PLAY_FOR = 5_000;
</script>

<script lang="ts">
	/* An image that may be animated (a GIF, an APNG), which can hold still: while `paused`, its first frame (what a
	   canvas draws of one), on a canvas in its place with its class and style. One paused before it has
	   loaded stays hidden until then (still taking its room, so it loads as a lazy image does), so it never moves.
	   A canvas may draw an image from another site: it only can't be read back, which this never does.
	   With `playFor`, one that plays calls `onstop` that long after it has loaded (or been played since), for the
	   one that owns `paused` to hold it still. */
	import type { MediaSrc } from './util';

	let { src, alt = '', paused = false, playFor, onstop, loading, class: className, style }: {
		src: MediaSrc;
		alt?: string;
		paused?: boolean;
		/** How long it plays before `onstop`, in ms; none, it plays on. */
		playFor?: number;
		onstop?: () => void;
		loading?: 'lazy' | 'eager';
		class?: string;
		style?: string;
	} = $props();

	let img = $state<HTMLImageElement>();
	/** It has loaded: there is a frame to draw. Not yet, again, for another `src`. */
	let loaded = $derived.by(() => {
		void src;
		return false;
	});

	$effect(() => {
		if (paused || !loaded || !playFor) return;
		const timer = setTimeout(() => onstop?.(), playFor);
		return () => clearTimeout(timer);
	});

	/** Draws the image's frame on `canvas`, at the image's own size, so that it takes the same room. */
	function still(canvas: HTMLCanvasElement): void {
		if (!img?.naturalWidth || !img.naturalHeight) return;
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		canvas.getContext('2d')?.drawImage(img, 0, 0);
	}
</script>

<img bind:this={img} {src} {alt} {loading} {style} class={[className, paused && (loaded ? 'ap-anim-held' : 'ap-anim-waiting')]} onload={() => (loaded = true)} />
{#if paused && loaded}<canvas class={className} {style} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : 'true'} data-testid="animation-still" {@attach still}></canvas>{/if}
