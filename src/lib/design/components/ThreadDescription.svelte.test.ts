// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import ThreadDescription from './ThreadDescription.svelte';
import * as dom from '$lib/test/dom';

describe('ThreadDescription', () => {
	it('opens the whole from a click on its text, not from a link in it, and puts itself away with ×', () => {
		const onexpand = vi.fn();
		const ondismiss = vi.fn();
		dom.render(ThreadDescription, { label: 'Room description', onexpand, ondismiss, children: dom.html('<div class="ap-msg-text"><p>Say <a href="#x">hello</a>.</p></div>') });
		expect(document.querySelector('section')?.getAttribute('aria-label')).toBe('Room description');
		document.querySelector<HTMLElement>('.ap-description-text p')!.click();
		document.querySelector<HTMLElement>('.ap-description-text a')!.click();
		expect(onexpand).toHaveBeenCalledOnce();
		dom.button('Hide description').click();
		expect(ondismiss).toHaveBeenCalledOnce();
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
