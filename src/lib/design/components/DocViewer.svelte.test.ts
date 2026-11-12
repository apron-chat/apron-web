// @vitest-environment jsdom
import { createRawSnippet, flushSync, tick } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import DocViewer from './DocViewer.svelte';
import { button, press, render, stubDialog } from '$lib/test/dom';

beforeAll(stubDialog);

const page = createRawSnippet(() => ({ render: () => '<div class="doc"><h1>Plan</h1><p>Ship it.</p></div>' }));

describe('DocViewer', () => {
	it('shows the document full screen as a page, titled, with Download and Close, and the document focused', () => {
		render(DocViewer, { open: true, title: 'plan.md', detail: 'Ada · 4:00 PM', href: 'https://files.example/plan.md', children: page, testid: 'viewer' });
		const dialog = document.querySelector('dialog')!;
		expect(dialog.open).toBe(true);
		expect(dialog.dataset.testid).toBe('viewer');
		expect(dialog.querySelector('h2')?.textContent).toBe('plan.md');
		expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id);
		expect(dialog.querySelector('.ap-viewer-detail')?.textContent).toBe('Ada · 4:00 PM');
		// Focused, so the keys that scroll a page scroll it: a region, Document in a dialog the file's name names.
		const stage = dialog.querySelector<HTMLElement>('.ap-docviewer-stage')!;
		expect(document.activeElement).toBe(stage);
		expect([stage.tabIndex, stage.getAttribute('role'), stage.getAttribute('aria-label')]).toEqual([0, 'region', 'Document']);
		const download = dialog.querySelector<HTMLAnchorElement>('a[aria-label="Download plan.md"]')!;
		expect([download.href, download.getAttribute('download'), download.target]).toEqual(['https://files.example/plan.md', 'plan.md', '_blank']);
		const article = dialog.querySelector('article.ap-docviewer-page')!;
		expect(article.querySelector('.doc h1')?.textContent).toBe('Plan');
		expect(article.parentElement).toBe(stage);
		// Its live region says it loaded, from where it said Loading.
		expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Loaded');
	});

	it('says why in place of the document, with Download under it only once it failed, and no link but a safe one', () => {
		const props = $state({ open: true, title: 'plan.md', href: 'https://files.example/plan.md', status: 'Loading…', failed: false, children: page });
		render(DocViewer, props);
		const stage = () => document.querySelector('.ap-docviewer-stage')!;
		expect(stage().querySelector('[role="status"]')?.textContent).toBe('Loading…');
		expect(stage().querySelector('article')).toBeNull();
		expect(stage().querySelector('a')).toBeNull();

		props.status = 'This file can’t be previewed here.';
		props.failed = true;
		flushSync();
		expect(stage().querySelector('[role="status"]')?.textContent).toBe('This file can’t be previewed here.');
		expect(stage().querySelector('a')?.textContent).toBe('Download');

		props.href = 'javascript:alert(1)';
		flushSync();
		expect(document.querySelectorAll('dialog a')).toHaveLength(0);
	});

	it('sizes the page from 100% to 200% with Smaller and Larger text, or − and + but not with Ctrl, and not while it says why', async () => {
		const props = $state<{ open: boolean; title: string; children: typeof page; zoom?: number; status?: string }>({ open: true, title: 'plan.md', children: page, zoom: undefined, status: undefined });
		render(DocViewer, props);
		const smaller = () => button('Smaller text') as HTMLButtonElement;
		const larger = () => button('Larger text') as HTMLButtonElement;
		const article = () => document.querySelector<HTMLElement>('article.ap-docviewer-page')!;
		// Unset, the stylesheet's size: no inline zoom (and here, where nothing is wider than a phone, 100%).
		expect([article().style.zoom, smaller().disabled, larger().disabled, larger().title]).toEqual(['', true, false, 'Larger text (+)']);
		larger().click();
		await tick();
		expect([props.zoom, article().style.zoom]).toEqual([1.25, '1.25']);
		const stage = document.querySelector('.ap-docviewer-stage')!;
		const key = (key: string, init: KeyboardEventInit = {}) => {
			stage.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
			flushSync();
		};
		key('+');
		key('=');
		key('+', { ctrlKey: true });
		expect(props.zoom).toBe(1.75);
		key('+');
		key('+');
		expect([props.zoom, larger().disabled]).toEqual([2, true]);
		key('-');
		expect(props.zoom).toBe(1.75);
		props.status = 'Loading…';
		flushSync();
		key('-');
		expect([props.zoom, document.querySelector('button[aria-label="Smaller text"]')]).toEqual([1.75, null]);
	});

	it('draws nothing while closed, and closes on Escape or Close, saying so', async () => {
		const onclose = vi.fn();
		const props = $state({ open: false, title: 'plan.md', children: page, onclose });
		render(DocViewer, props);
		const dialog = document.querySelector('dialog')!;
		expect([dialog.open, dialog.querySelector('article')]).toEqual([false, null]);

		props.open = true;
		flushSync();
		expect(press(dialog.querySelector('.ap-docviewer-stage')!, 'Escape')).toBe(false);
		flushSync();
		await tick();
		expect([props.open, dialog.open, onclose.mock.calls.length]).toEqual([false, false, 1]);

		props.open = true;
		flushSync();
		button('Close').click();
		flushSync();
		expect([props.open, dialog.open, onclose.mock.calls.length]).toEqual([false, false, 2]);
	});

	it('closes on a click beside the page; not on it, a drag, a right click, a press let go on it, its scrollbar, or with text selected', () => {
		const props = $state({ open: true, title: 'plan.md', children: page });
		render(DocViewer, props);
		const stage = document.querySelector<HTMLElement>('.ap-docviewer-stage')!;
		const text = document.querySelector('.doc p')!;
		// The test DOM lays nothing out: the stage is 800×600 at the origin, its last 15 px a classic scrollbar (Windows, Linux).
		Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 785 });
		Object.defineProperty(stage, 'clientHeight', { configurable: true, value: 600 });
		const press = (down: Element, [x, y]: number[], up = down, [x2, y2] = [x, y], button = 0) => {
			down.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button }));
			up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x2, clientY: y2, button }));
			// A click goes to what both have in common.
			(down === up ? down : stage).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x2, clientY: y2, button }));
			flushSync();
		};
		press(text, [300, 100]);
		press(stage, [100, 100], stage, [140, 100]);
		press(stage, [100, 100], stage, [100, 100], 2);
		press(stage, [100, 100], text, [102, 100]);
		press(stage, [790, 100]);
		getSelection()!.selectAllChildren(text);
		press(stage, [100, 100]);
		expect(props.open).toBe(true);
		getSelection()!.removeAllRanges();
		press(stage, [100, 100]);
		expect([props.open, document.querySelector('dialog')!.open]).toEqual([false, false]);
	});
});
