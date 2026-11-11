// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from '$lib/test/app-page.svelte';
import { render, stubDialog } from '$lib/test/dom';
import type { DocText } from '$lib/ui/doc-text';
import { docViewer } from '$lib/ui/doc-viewer.svelte';
import DocViewerHost from './DocViewerHost.svelte';

vi.mock('$app/state', async () => ({ page: (await import('$lib/test/app-page.svelte')).page }));
vi.mock('$app/navigation', async () => ({ pushState: (await import('$lib/test/app-page.svelte')).pushState }));

/** Each read the viewer asks for, settled when the test says: its URL, whether it was let go, and how to answer it. */
const reads: { url: string; signal?: AbortSignal; answer: (doc: DocText) => Promise<void> }[] = [];
vi.mock('$lib/ui/doc-text', async (actual) => ({
	...(await actual<typeof import('$lib/ui/doc-text')>()),
	readDoc: (url: string, signal?: AbortSignal) => new Promise<DocText>((resolve) => {
		reads.push({ url, signal, answer: async (doc) => (resolve(doc), await tick(), flushSync()) });
	})
}));

beforeAll(stubDialog);

beforeEach(() => {
	reads.length = 0;
	page.state = {};
	vi.spyOn(history, 'back').mockImplementation(() => undefined);
});

afterEach(() => {
	if (docViewer.open) docViewer.closed();
	flushSync();
	vi.restoreAllMocks();
});

const URL = 'https://files.example/plan.md';
const text = () => document.querySelector('[data-testid="doc-viewer-text"]');
const status = () => document.querySelector('.ap-docviewer-status p')?.textContent;

function open(url = URL): void {
	docViewer.show({ url, title: 'plan.md' });
	flushSync();
}

describe('DocViewerHost', () => {
	it('reads the file for each open: reopened, it shows Loading, never the last read, until the new one comes', async () => {
		render(DocViewerHost);
		open();
		expect(status()).toBe('Loading…');
		await reads[0].answer({ text: '# First' });
		expect(text()?.querySelector('h1')?.textContent).toBe('First');

		docViewer.closed();
		flushSync();
		expect(reads[0].signal?.aborted).toBe(true);
		open();
		expect([status(), text()]).toEqual(['Loading…', null]);
		await reads[1].answer({ text: '# Second' });
		expect(text()?.querySelector('h1')?.textContent).toBe('Second');
	});

	it('drops a read that comes after its open closed, and says what kept one from showing', async () => {
		render(DocViewerHost);
		open();
		docViewer.closed();
		flushSync();
		open('https://files.example/other.md');
		await reads[0].answer({ text: '# Stale' });
		expect([status(), text()]).toEqual(['Loading…', null]);
		await reads[1].answer({ error: 'large' });
		expect(status()).toBe('This file is too large to preview.');
		expect(document.querySelector('.ap-docviewer-status a')?.textContent).toBe('Download');
	});

	it('opened again in the moment it closes, before its `close` event has come, stays open on the new file', async () => {
		// As a browser does: closed at once, the event a task later.
		const close = vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
			this.open = false;
			setTimeout(() => this.dispatchEvent(new Event('close')));
		});
		render(DocViewerHost);
		open();
		await reads[0].answer({ text: '# First' });
		document.querySelector('dialog')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect([close.mock.calls.length, document.querySelector('dialog')!.open]).toEqual([1, false]);
		open('https://files.example/other.md');
		await new Promise((settle) => setTimeout(settle));
		flushSync();
		expect([docViewer.open, document.querySelector('dialog')?.open, docViewer.view?.url]).toEqual([true, true, 'https://files.example/other.md']);
		await reads[1].answer({ text: '# Other' });
		expect(text()?.querySelector('h1')?.textContent).toBe('Other');
	});

	it('scrolls to the heading a link names, and Back closes it', async () => {
		render(DocViewerHost);
		open();
		await reads[0].answer({ text: '[Jump](#getting-started)\n\n## Getting started' });
		const heading = text()!.querySelector('h2')!;
		heading.scrollIntoView = vi.fn();
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		text()!.querySelector('a')!.dispatchEvent(click);
		expect([click.defaultPrevented, vi.mocked(heading.scrollIntoView).mock.calls.length]).toEqual([true, 1]);

		expect(page.state.doc).toBeGreaterThan(0);
		page.state = {};
		flushSync();
		await tick();
		expect([docViewer.open, document.querySelector('dialog')]).toEqual([false, null]);
		expect(history.back).not.toHaveBeenCalled();
	});
});
