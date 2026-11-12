// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import MediaViewer from './MediaViewer.svelte';
import { button, press, render, stubDialog } from '$lib/test/dom';
import { media } from '$lib/test/media';

beforeAll(stubDialog);

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';
const items = [
	{ src: media(PIXEL), title: 'dusk.jpg', detail: 'Grace · 4:00 PM', href: 'https://files.example/dusk.jpg' },
	{ src: media(PIXEL), title: 'dawn.jpg' }
];

describe('MediaViewer', () => {
	it('shows an image titled, counted and linked, pages with the arrows, and closes on Escape', () => {
		const onclose = vi.fn();
		const props = $state({ open: true, items, index: 0, onclose });
		render(MediaViewer, props);
		const dialog = document.querySelector('dialog')!;
		const title = () => dialog.querySelector('h2')?.textContent;
		expect([dialog.open, title(), dialog.querySelector('.ap-viewer-count')?.textContent]).toEqual([true, 'dusk.jpg', '1 of 2']);
		expect(dialog.querySelector('.ap-viewer-detail')?.textContent).toBe('Grace · 4:00 PM');
		expect(dialog.querySelector<HTMLAnchorElement>('a[aria-label="Open original in a new tab"]')?.href).toBe('https://files.example/dusk.jpg');
		expect(document.activeElement).toBe(button('Close'));

		expect(press(dialog, 'ArrowRight')).toBe(false);
		flushSync();
		expect([props.index, title(), dialog.querySelector('a[aria-label="Open original in a new tab"]')]).toEqual([1, 'dawn.jpg', null]);
		expect(button('Next image').disabled).toBe(true);
		press(dialog, 'ArrowLeft');
		flushSync();
		expect(props.index).toBe(0);

		expect(press(dialog, 'Escape')).toBe(false);
		flushSync();
		expect([props.open, dialog.open, onclose.mock.calls.length]).toEqual([false, false, 1]);
	});

	it('closes on a press beside the image, not on the image itself', () => {
		const props = $state({ open: true, items, index: 0 });
		render(MediaViewer, props);
		const pressOn = (target: Element) => {
			target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
			target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
			target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			flushSync();
		};
		pressOn(document.querySelector('img')!);
		expect(props.open).toBe(true);
		pressOn(document.querySelector('.ap-viewer-stage')!);
		expect([props.open, document.querySelector('dialog')!.open]).toEqual([false, false]);
	});

	it('doesn\'t open with nothing to show', () => {
		render(MediaViewer, { open: true, items: [] });
		expect(document.querySelector('dialog')!.open).toBe(false);
	});
});
