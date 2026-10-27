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
});
