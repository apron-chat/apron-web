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
});
