// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import ThreadDescription from './ThreadDescription.svelte';
import * as dom from '$lib/test/dom';

/** Its first lines cut off or not: jsdom lays nothing out, so the text's box reports what a browser's would. */
let cut = false;
beforeEach(() => {
	cut = false;
	vi.stubGlobal('ResizeObserver', class {
		constructor(private readonly measure: () => void) {}
		observe(): void { this.measure(); }
		unobserve(): void {}
		disconnect(): void {}
	});
	vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => (cut ? 300 : 0));
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function render(props: Record<string, unknown>): void {
	dom.render(ThreadDescription, props);
	flushSync();
}

describe('ThreadDescription', () => {
	it('cut off, opens the whole from Read all or a click anywhere on it, not from a link in it nor its ×, which puts it away', () => {
		cut = true;
		const onexpand = vi.fn();
		const ondismiss = vi.fn();
		render({ label: 'Room description', onexpand, ondismiss, children: dom.html('<div class="ap-msg-text"><p>Say <a href="#x">hello</a>.</p></div>') });
		expect(document.querySelector('section')?.getAttribute('aria-label')).toBe('Room description');
		document.querySelector<HTMLElement>('.ap-description-text p')!.click();
		document.querySelector<HTMLElement>('.ap-description-text a')!.click();
		expect(onexpand).toHaveBeenCalledOnce();
		document.querySelector<HTMLElement>('section')!.click();
		expect(onexpand).toHaveBeenCalledTimes(2);
		dom.button('Read all').click();
		expect(onexpand).toHaveBeenCalledTimes(3);
		dom.button('Hide description').click();
		expect(ondismiss).toHaveBeenCalledOnce();
		expect(onexpand).toHaveBeenCalledTimes(3);
		// The icon beside its first line is named for the pointer; the region's label names it already.
		expect(document.querySelector('.ap-description-icon')?.getAttribute('title')).toBe('Room description');
	});

	it('all there in its first lines, has no Read all and opens nothing, as the whole would show the same', () => {
		const onexpand = vi.fn();
		render({ description: 'Say hello.', onexpand });
		expect(dom.queryByRole('button', 'Read all')).toBeNull();
		expect(document.querySelector('.ap-description-foot')).toBeNull();
		document.querySelector<HTMLElement>('.ap-description-text p')!.click();
		expect(onexpand).not.toHaveBeenCalled();
		expect(document.querySelector('section')?.classList.contains('ap-description-opens')).toBe(false);
	});

	it('offers its pencil to edit it, cut off or not', () => {
		const onedit = vi.fn();
		const onexpand = vi.fn();
		render({ description: 'Say hello.', onexpand, onedit });
		dom.button('Edit description').click();
		expect(onedit).toHaveBeenCalledOnce();
		expect(onexpand).not.toHaveBeenCalled();
	});

	it('says an edit of it is kept as a draft, which takes it up', () => {
		const ondraft = vi.fn();
		render({ description: 'Say hello.', draft: true, ondraft });
		expect(document.querySelector('.ap-msg-text')?.textContent).toBe('Say hello.');
		dom.button('Unsaved draft').click();
		expect(ondraft).toHaveBeenCalledOnce();
		// Nothing to open it with: no Read all.
		expect(dom.queryByRole('button', 'Read all')).toBeNull();
	});
});
