/**
 * The geometry of zooming an image in place (MediaViewer): how much larger it is drawn and how far it is moved, kept so
 * the image never leaves a gap it could fill. Drawn as `translate(x, y) scale(scale)` about the image's own centre.
 */

/** How the image is drawn: `scale` times its fitted size, moved by `x` and `y` (CSS pixels) from where it sits. */
export interface Zoom {
	readonly scale: number;
	readonly x: number;
	readonly y: number;
}

/** Where the image sits unzoomed, in its stage: its centre (`cx`, `cy`) and size (`w`, `h`); and the stage's size (`width`, `height`). */
export interface Frame {
	readonly cx: number;
	readonly cy: number;
	readonly w: number;
	readonly h: number;
	readonly width: number;
	readonly height: number;
}

export const UNZOOMED: Zoom = { scale: 1, x: 0, y: 0 };

/** How far in a double tap zooms. */
export const TAP_ZOOM = 2.5;

/** The most it zooms: four times, or until a pixel of the image is drawn a CSS pixel across, whichever is more. */
export function maxScale(frame: Frame, naturalWidth: number): number {
	return Math.max(4, frame.w > 0 ? naturalWidth / frame.w : 0);
}

/** One axis's move, kept so the image covers the stage where it is larger than it, and stays inside it where it isn't. */
function clampAxis(move: number, centre: number, size: number, stage: number): number {
	const half = size / 2;
	const a = half - centre;
	const b = stage - centre - half;
	return Math.min(Math.max(move, Math.min(a, b)), Math.max(a, b));
}

/** `zoom` within 1 and `max`, moved no further than `clampAxis` allows; at 1, where it sits. */
export function clampZoom(zoom: Zoom, frame: Frame, max: number): Zoom {
	const scale = Math.min(Math.max(zoom.scale, 1), max);
	if (scale === 1) return UNZOOMED;
	return {
		scale,
		x: clampAxis(zoom.x, frame.cx, frame.w * scale, frame.width),
		y: clampAxis(zoom.y, frame.cy, frame.h * scale, frame.height)
	};
}

/**
 * `zoom` drawn at `scale`, the point of the image at (`fx`, `fy`) in the stage staying there (where fingers pinch, a
 * double tap lands, a wheel turns), then moved by (`dx`, `dy`), as two fingers moving together pan; clamped.
 */
export function zoomAt(zoom: Zoom, frame: Frame, max: number, fx: number, fy: number, scale: number, dx = 0, dy = 0): Zoom {
	const next = Math.min(Math.max(scale, 1), max);
	const ratio = next / zoom.scale;
	// From the image's centre, where it sits unzoomed: the focal point stays put as the scale changes.
	const px = fx - frame.cx;
	const py = fy - frame.cy;
	return clampZoom({ scale: next, x: px - ratio * (px - zoom.x) + dx, y: py - ratio * (py - zoom.y) + dy }, frame, max);
}
