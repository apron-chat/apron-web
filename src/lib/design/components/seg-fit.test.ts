// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitsOneLine, segFit } from './seg-fit';

describe('fitsOneLine', () => {
	it('fits choices side by side while their widths and the gaps between them fit, to the pixel', () => {
		// 60 + 80 + 50 and two gaps of 2: 194.
		expect(fitsOneLine([60, 80, 50], 2, 194)).toBe(true);
		expect(fitsOneLine([60, 80, 50], 2, 400)).toBe(true);
		expect(fitsOneLine([60, 80, 50], 2, 193.5)).toBe(false);
		expect(fitsOneLine([400], 2, 346)).toBe(false);
		expect(fitsOneLine([], 2, 0)).toBe(true);
	});
});

describe('segFit', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	});

	it('stacks the choices where they don’t fit on one line, from their names’ widths, and again as the control is resized', () => {
		let resized = () => {};
		vi.stubGlobal('ResizeObserver', class {
			constructor(callback: () => void) { resized = callback; }
			observe(): void {}
			disconnect(): void {}
		});
		vi.stubGlobal('requestAnimationFrame', (run: () => void) => (run(), 1));
		const seg = document.createElement('div');
		seg.innerHTML = '<button class="ap-seg-item" style="padding: 0 8px"></button><button class="ap-seg-item" style="padding: 0 8px"></button>';
		seg.style.cssText = 'column-gap: 2px; padding: 0 2px';
		document.body.append(seg);
		let width = 150;
		Object.defineProperty(seg, 'clientWidth', { get: () => width });
		// Ten px a character, a fraction over: each rounds up, with its padding, to 87 and 67, 156 with the gap and 160 with the control’s padding.
		const destroy = segFit(['Passkey', 'Guest'], (_item, names) => names.map((name) => name.length * 10 + 0.2))(seg) as () => void;
		expect(seg.classList.contains('ap-seg-stacked')).toBe(true);
		width = 160;
		resized();
		expect(seg.classList.contains('ap-seg-stacked')).toBe(false);
		width = 159;
		resized();
		expect(seg.classList.contains('ap-seg-stacked')).toBe(true);
		destroy();
	});

	it('leaves a hidden control as it is, and does nothing where nothing says when it’s resized', () => {
		vi.stubGlobal('ResizeObserver', undefined);
		const seg = document.createElement('div');
		seg.innerHTML = '<button class="ap-seg-item"></button>';
		const measure = vi.fn(() => [1000]);
		segFit(['Guest'], measure)(seg);
		expect(measure).not.toHaveBeenCalled();
		vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
		segFit(['Guest'], measure)(seg);
		expect(measure).toHaveBeenCalledOnce();
		expect(seg.classList.contains('ap-seg-stacked')).toBe(false);
	});
});
