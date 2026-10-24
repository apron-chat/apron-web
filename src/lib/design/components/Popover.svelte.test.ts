// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Popover from './Popover.svelte';
import * as dom from '$lib/test/dom';

// jsdom has no ResizeObserver, which `bind:offsetHeight` uses.
beforeEach(() => {
	dom.stubResizeObserver();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Popover', () => {
	it('sits where it is placed as a popover, and along the bottom as a sheet, at its height either way', () => {
		dom.render(Popover, { mode: 'popover' as const, top: 10, left: 20, width: 300, height: 200, children: dom.html('<p>Hello</p>'), label: 'Hello' });
		let box = dom.byRole('dialog', 'Hello');
		expect([box.style.top, box.style.left, box.style.width, box.style.height]).toEqual(['10px', '20px', '300px', '200px']);
		expect(box.getAttribute('tabindex')).toBe('-1');
		expect(box.classList.contains('ap-popover-sheet')).toBe(false);
		dom.unmount();
		dom.render(Popover, { mode: 'sheet' as const, top: 10, left: 20, width: 300, height: 200, children: dom.html('<p>Hello</p>'), label: 'Hello' });
		box = dom.byRole('dialog', 'Hello');
		expect([box.style.top, box.style.left, box.style.width, box.style.height]).toEqual(['', '', '', '200px']);
		expect(box.classList.contains('ap-popover-sheet')).toBe(true);
	});
});
