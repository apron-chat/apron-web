import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyboardFit, trackKeyboard } from './viewport';

/** An iPhone 14's layout viewport, as tall as the screen under the status bar. */
const LAYOUT = 844;

describe('fitting the app to the keyboard', () => {
	it('leaves the app be while nothing covers the page, a pinch zoom included', () => {
		expect(keyboardFit({ height: 844, offsetTop: 0, scale: 1 }, LAYOUT)).toBeUndefined();
		// A toolbar collapsing gives the visual viewport more than the layout viewport, not less.
		expect(keyboardFit({ height: 890, offsetTop: 0, scale: 1 }, LAYOUT)).toBeUndefined();
		expect(keyboardFit({ height: 843.4, offsetTop: 0, scale: 1 }, LAYOUT)).toBeUndefined();
		// A pinch zoom magnifies the page rather than covering it.
		expect(keyboardFit({ height: 422, offsetTop: 200, scale: 2 }, LAYOUT)).toBeUndefined();
	});

	it('takes the height above the keyboard and follows the page as the browser pans it, never above its top', () => {
		expect(keyboardFit({ height: 508, offsetTop: 0, scale: 1 }, LAYOUT)).toEqual({ height: 508, top: 0 });
		expect(keyboardFit({ height: 507.6, offsetTop: 335.8, scale: 1 }, LAYOUT)).toEqual({ height: 508, top: 336 });
		// Never above the top of the page: iOS overscroll can report a negative offset as the page bounces.
		expect(keyboardFit({ height: 508, offsetTop: -12, scale: 1 }, LAYOUT)).toEqual({ height: 508, top: 0 });
	});
});

describe('hearing the keyboard', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('tells onchange the height the app takes, from the start and as it changes', () => {
		const viewport = Object.assign(new EventTarget(), { height: LAYOUT, offsetTop: 0, scale: 1 });
		vi.stubGlobal('window', { visualViewport: viewport });
		const root = { clientHeight: LAYOUT, style: { setProperty: () => {}, removeProperty: () => {} }, dataset: {} as DOMStringMap } as unknown as HTMLElement;
		const heard: number[] = [];
		const stop = trackKeyboard((height) => heard.push(height), root);
		const resize = (height: number) => {
			viewport.height = height;
			viewport.dispatchEvent(new Event('resize'));
		};
		resize(508);
		// The browser panning the page with the keyboard up is no news: the app is as tall as it was.
		viewport.offsetTop = 336;
		viewport.dispatchEvent(new Event('scroll'));
		// The keyboard's suggestions bar coming up is.
		resize(470);
		resize(LAYOUT);
		resize(508);
		stop();
		expect(heard).toEqual([LAYOUT, 508, 470, LAYOUT, 508]);
	});
});
