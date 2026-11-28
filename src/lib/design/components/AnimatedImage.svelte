<script lang="ts">
	/* An image that may be animated (a GIF, an APNG), which can hold still: while `paused`, its first frame (what a
	   canvas draws of one), on a canvas in its place with its class and style. One paused before it has
	   loaded stays hidden until then (still taking its room, so it loads as a lazy image does), so it never moves.
	   A canvas may draw an image from another site: it only can't be read back, which this never does. */
	let { src, alt = '', paused = false, loading, class: className, style }: {
		src: string;
		alt?: string;
		paused?: boolean;
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
