// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import ThreadDescription from './ThreadDescription.svelte';
import * as dom from '$lib/test/dom';

describe('ThreadDescription', () => {
	it('opens the whole from a click anywhere on it, not from a link in it nor its ×, which puts it away', () => {
		const onexpand = vi.fn();
		const ondismiss = vi.fn();
		dom.render(ThreadDescription, { label: 'Room description', onexpand, ondismiss, children: dom.html('<div class="ap-msg-text"><p>Say <a href="#x">hello</a>.</p></div>') });
		expect(document.querySelector('section')?.getAttribute('aria-label')).toBe('Room description');
		document.querySelector<HTMLElement>('.ap-description-text p')!.click();
		document.querySelector<HTMLElement>('.ap-description-text a')!.click();
		expect(onexpand).toHaveBeenCalledOnce();
		document.querySelector<HTMLElement>('section')!.click();
		expect(onexpand).toHaveBeenCalledTimes(2);
		dom.button('Hide description').click();
		expect(ondismiss).toHaveBeenCalledOnce();
		expect(onexpand).toHaveBeenCalledTimes(2);
		// The icon beside its first line is named for the pointer; the region's label names it already.
		expect(document.querySelector('.ap-description-icon')?.getAttribute('title')).toBe('Room description');
	});

	it('says an edit of it is kept as a draft, which takes it up', () => {
		const ondraft = vi.fn();
		dom.render(ThreadDescription, { description: 'Say hello.', draft: true, ondraft });
		expect(document.querySelector('.ap-msg-text')?.textContent).toBe('Say hello.');
		dom.button('Unsaved draft').click();
		expect(ondraft).toHaveBeenCalledOnce();
		// Nothing cut off here (no layout): no Read all.
		expect(dom.queryByRole('button', 'Read all')).toBeNull();
	});
});
