import type { Attachment } from 'svelte/attachments';

/**
 * Whether choices of these `widths` (each its whole text and padding, unwrapped) fit side by side, `gap` apart, in
 * `available` px. The widths come rounded up (`segFit`), as layout's come in fractions and a choice a fraction short clips.
 */
export function fitsOneLine(widths: readonly number[], gap: number, available: number): boolean {
	const need = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(widths.length - 1, 0);
	return need <= available;
}

let context: CanvasRenderingContext2D | null | undefined;

/** Each name's width in px in `item`'s font, by canvas: its text alone, unwrapped and apart from any layout. */
export function textWidths(item: HTMLElement, names: readonly string[]): number[] | undefined {
	context ??= document.createElement('canvas').getContext('2d');
	if (!context) return undefined;
	const s = getComputedStyle(item);
	context.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
	return names.map((name) => context!.measureText(name).width);
}

/**
 * A segmented control (`.ap-seg`) on one line while its choices fit there whole, else one choice to a row
 * (`ap-seg-stacked`). What one line needs is worked out from `names` and the choices' font and padding, once per set
 * of names and again as fonts load, never from the layout shown: the two modes keep a choice's font and inline
 * padding, and the control's width is its container's, so which mode shows depends only on the room, and can't flip
 * back and forth. Decided as it mounts, before it's painted; then again as it's resized, a frame later (changing its
 * height inside its own ResizeObserver would be a loop).
 */
export function segFit(names: readonly string[], measure = textWidths): Attachment<HTMLElement> {
	return (seg) => {
		if (typeof ResizeObserver !== 'function') return;
		let need: number[] = [];
		let gap = 0;
		let pad = 0;
		const refit = () => {
			const item = seg.querySelector<HTMLElement>('.ap-seg-item');
			const widths = item && measure(item, names);
			if (!item || !widths) return;
			const own = getComputedStyle(item);
			const box = getComputedStyle(seg);
			const inline = parseFloat(own.paddingLeft) + parseFloat(own.paddingRight) + parseFloat(own.borderLeftWidth) + parseFloat(own.borderRightWidth);
			need = widths.map((width) => Math.ceil(width + inline));
			gap = parseFloat(box.columnGap) || 0;
			pad = parseFloat(box.paddingLeft) + parseFloat(box.paddingRight);
			apply();
		};
		/** Hidden (no width), it keeps its mode until it shows. */
		const apply = () => seg.clientWidth && seg.classList.toggle('ap-seg-stacked', !fitsOneLine(need, gap, seg.clientWidth - pad));
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(apply);
		});
		refit();
		observer.observe(seg);
		let live = true;
		const fonts = typeof document.fonts === 'object' ? document.fonts : undefined;
		const loaded = () => live && refit();
		void fonts?.ready.then(loaded);
		fonts?.addEventListener('loadingdone', loaded);
		return () => {
			live = false;
			cancelAnimationFrame(frame);
			observer.disconnect();
			fonts?.removeEventListener('loadingdone', loaded);
		};
	};
}
