// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import MessageEditor from './MessageEditor.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	dom.render(MessageEditor, { value: 'hi', ...props });
	return document.querySelector<HTMLElement>('.ap-msgedit')!;
}

const key = (target: Element, init: KeyboardEventInit) => {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(event);
	return event;
};

describe('MessageEditor', () => {
	it('saves on Enter with a keyboard, as the composer sends (enterAction); Shift+Enter and a handheld’s Enter break the line', () => {
		const onsave = vi.fn();
		const field = render({ onsave }).querySelector('textarea')!;
		expect(key(field, { key: 'Enter' }).defaultPrevented).toBe(true);
		expect(onsave).toHaveBeenCalledOnce();
		expect(key(field, { key: 'Enter', shiftKey: true }).defaultPrevented).toBe(false);
		expect(onsave).toHaveBeenCalledOnce();
		dom.unmount();
		const handheld = render({ onsave, handheld: true }).querySelector('textarea')!;
		expect(key(handheld, { key: 'Enter' }).defaultPrevented).toBe(false);
		expect(onsave).toHaveBeenCalledOnce();
	});

	it('takes a class and a test id on its root, and Escape anywhere in it cancels', () => {
		const oncancel = vi.fn();
		const root = render({ oncancel, class: 'mine' });
		expect([...root.classList]).toEqual(['ap-msgedit', 'mine']);
		key(root.querySelector('textarea')!, { key: 'Escape' });
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('takes your own field and picker in place of the textarea, and Escape a field handles first doesn\u2019t cancel', () => {
		const oncancel = vi.fn();
		const root = render({
			oncancel,
			field: dom.html('<div role="textbox" aria-label="Edit message" tabindex="0"></div>'),
			picker: dom.html('<ul class="ap-mpick" role="listbox"></ul>')
		});
		expect(root.querySelector('textarea')).toBeNull();
		const wrap = root.querySelector('.ap-msgedit-wrap')!;
		expect(wrap.querySelector('[role="listbox"]')).not.toBeNull();
		const field = wrap.querySelector('[role="textbox"]')!;
		field.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
		key(field, { key: 'Escape' });
		expect(oncancel).not.toHaveBeenCalled();
		key(field, { key: 'Escape' });
		expect(oncancel).toHaveBeenCalledOnce();
	});
});
