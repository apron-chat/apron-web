import { describe, expect, it } from 'vitest';
import { clampZoom, maxScale, UNZOOMED, zoomAt, type Frame } from './zoom';

/** A 300 × 200 image in the middle of a 400 × 600 stage. */
const frame: Frame = { cx: 200, cy: 300, w: 300, h: 200, width: 400, height: 600 };

describe('zoomAt', () => {
	it('keeps the point zoomed about where it was', () => {
		// The image's point at (250, 300), 50 right of its centre, stays at 250 at twice the size.
		const zoom = zoomAt(UNZOOMED, frame, 4, 250, 300, 2);
		expect(zoom).toEqual({ scale: 2, x: -50, y: 0 });
		const drawnAt = (offset: number) => frame.cx + zoom.x + zoom.scale * offset;
		expect(drawnAt(50)).toBe(250);
		// Again about the same point, from there: it still stays.
		const again = zoomAt(zoom, frame, 4, 250, 300, 3);
		expect(frame.cx + again.x + again.scale * 50).toBe(250);
	});

	it('moves by how far two fingers moved together, and keeps within 1 and the most', () => {
		expect(zoomAt(UNZOOMED, frame, 4, 200, 300, 2, 30, 0)).toEqual({ scale: 2, x: 30, y: 0 });
		expect(zoomAt(UNZOOMED, frame, 4, 200, 300, 10).scale).toBe(4);
		expect(zoomAt({ scale: 2, x: 40, y: 10 }, frame, 4, 200, 300, 0.5)).toEqual(UNZOOMED);
	});
});

describe('clampZoom', () => {
	it('never leaves a gap where the image is larger than the stage, and keeps it inside where it isn\'t', () => {
		// At 2: 600 wide in a 400 stage, so it moves at most 100 either way; 400 high in 600, so it stays within the stage, 100 either way.
		expect(clampZoom({ scale: 2, x: 500, y: 500 }, frame, 4)).toEqual({ scale: 2, x: 100, y: 100 });
		expect(clampZoom({ scale: 2, x: -500, y: -500 }, frame, 4)).toEqual({ scale: 2, x: -100, y: -100 });
		// At 4: 800 high in 600, so 100 either way the other way round: it covers the stage top to bottom.
		expect(clampZoom({ scale: 4, x: 0, y: 500 }, frame, 4)).toEqual({ scale: 4, x: 0, y: 100 });
	});
});

describe('maxScale', () => {
	it('zooms to four times, or until a pixel of the image is one on the screen', () => {
		expect(maxScale(frame, 600)).toBe(4);
		expect(maxScale(frame, 3000)).toBe(10);
	});
});
