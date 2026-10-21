/**
 * An on-screen keyboard on iOS (and in Chrome on Android) covers the page rather
 * than resizing it: the visual viewport, the part on screen, shrinks, and the
 * browser pans it down the page to keep the focused field in view. A 100dvh app
 * then runs on under the keyboard and its header goes off the top. While the
 * keyboard is up the app is fitted to the visual viewport instead: as tall as
 * it, and moved down with it.
 */

export interface VisualViewportLike {
	height: number;
	offsetTop: number;
	scale: number;
}

export interface KeyboardFit {
	/** The visual viewport's height, which the app takes. */
	height: number;
	/** How far the browser panned the visual viewport down the page, which the app moves down by. */
	top: number;
}

/** Covering less than this is rounding, not a keyboard. */
const COVERED_MIN_PX = 2;

/**
 * The fit while something covers the bottom of the page (`layoutHeight`, the
 * layout viewport's height), or undefined when nothing does. Pinch-zoomed, the
 * visual viewport is a magnifier over the page, not room taken from it: no fit.
 */
export function keyboardFit(viewport: VisualViewportLike, layoutHeight: number): KeyboardFit | undefined {
	if (Math.abs(viewport.scale - 1) > 0.01) return undefined;
	if (layoutHeight - viewport.height < COVERED_MIN_PX) return undefined;
	return { height: Math.round(viewport.height), top: Math.max(0, Math.round(viewport.offsetTop)) };
}

/**
 * Keeps `--app-height`, `--app-top` and `data-keyboard` on the root element up
 * to date with the keyboard; all three are absent while it's down. Returns the
 * cleanup.
 */
export function trackKeyboard(root: HTMLElement = document.documentElement): () => void {
	const viewport = window.visualViewport;
	if (!viewport) return () => {};
	const update = () => {
		const fit = keyboardFit(viewport, root.clientHeight);
		if (fit) {
			root.style.setProperty('--app-height', `${fit.height}px`);
			root.style.setProperty('--app-top', `${fit.top}px`);
			root.dataset.keyboard = '';
		} else {
			root.style.removeProperty('--app-height');
			root.style.removeProperty('--app-top');
			delete root.dataset.keyboard;
		}
	};
	update();
	viewport.addEventListener('resize', update);
	viewport.addEventListener('scroll', update);
	return () => {
		viewport.removeEventListener('resize', update);
		viewport.removeEventListener('scroll', update);
		root.style.removeProperty('--app-height');
		root.style.removeProperty('--app-top');
		delete root.dataset.keyboard;
	};
}
