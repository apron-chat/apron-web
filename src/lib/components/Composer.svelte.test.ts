// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Composer from './Composer.svelte';
import * as dom from '$lib/test/dom';

function render(props: Record<string, unknown>) {
	const onsend = vi.fn();
	dom.render(Composer, { value: 'Back in a bit', placeholder: 'Message General', disabled: false, canUpload: false, people: [], oninput: vi.fn(), onsend, onfiles: vi.fn(), onunstage: vi.fn(), onrename: vi.fn(), oncancelreply: vi.fn(), ...props } as never);
	flushSync();
	return { onsend, field: document.querySelector<HTMLElement>('[data-testid="message-input"]')!, send: document.querySelector<HTMLButtonElement>('[data-testid="send-button"]')! };
}

describe('Composer', () => {
	it('holding Send takes typing but sends nothing: Send is off, and Enter keeps the draft', () => {
		const { onsend, field, send } = render({ holdSend: true });
		expect(field.getAttribute('contenteditable')).not.toBe('false');
		expect(send.disabled).toBe(true);
		dom.press(field, 'Enter');
		expect(onsend).not.toHaveBeenCalled();
		expect(field.textContent).toBe('Back in a bit');
		dom.unmount();

		// Once it's let go, the same draft sends.
		const live = render({ holdSend: false });
		expect(live.send.disabled).toBe(false);
		dom.press(live.field, 'Enter');
		expect(live.onsend).toHaveBeenCalledOnce();
	});

	it('Escape while replying cancels the reply; without one it does nothing of the composer\'s', () => {
		const oncancelreply = vi.fn();
		const replying = render({ reply: { name: 'Ada', text: 'Lunch?' }, oncancelreply });
		expect(dom.press(replying.field, 'Escape')).toBe(false);
		expect(oncancelreply).toHaveBeenCalledOnce();
		dom.unmount();

		const plain = render({ oncancelreply });
		expect(dom.press(plain.field, 'Escape')).toBe(true);
		expect(oncancelreply).toHaveBeenCalledOnce();
	});

	it('↑ in the empty field goes up to the messages, and leaves the key alone with a draft, a modifier or none to go to', () => {
		const onup = vi.fn(() => true);
		const empty = render({ value: '', onup });
		expect(dom.press(empty.field, 'ArrowUp', { shiftKey: true })).toBe(true);
		expect(onup).not.toHaveBeenCalled();
		expect(dom.press(empty.field, 'ArrowUp')).toBe(false);
		expect(onup).toHaveBeenCalledOnce();
		dom.unmount();

		// A draft keeps ↑ for moving the caret.
		const drafted = render({ onup });
		expect(dom.press(drafted.field, 'ArrowUp')).toBe(true);
		expect(onup).toHaveBeenCalledOnce();
		dom.unmount();

		// No messages to go to: the key is the field's.
		const none = render({ value: '', onup: () => false });
		expect(dom.press(none.field, 'ArrowUp')).toBe(true);
	});

	it('offers Expand once the draft has a second line, then writes at length: Enter breaks lines, Ctrl+Enter sends, Esc closes', async () => {
		const field = () => document.querySelector<HTMLElement>('[data-testid="message-input"]')!;
		const panel = () => document.querySelector('[data-testid="composer-panel"]');
		render({ value: 'one line' });
		expect(document.querySelector('[data-testid="composer-expand"]')).toBeNull();
		dom.unmount();

		const { onsend, field: compact } = render({ value: 'Plan\n- canary' });
		document.querySelector<HTMLButtonElement>('[data-testid="composer-expand"]')!.click();
		flushSync();
		await tick();
		expect(panel()).not.toBeNull();
		expect(document.querySelector('[data-testid="composer-expand"]')).toBeNull();
		// The same field, the draft in it as it was.
		expect(field()).toBe(compact);
		expect(field().textContent).toBe('Plan\n- canary');
		document.execCommand = vi.fn(() => true);
		dom.press(field(), 'Enter', { shiftKey: true });
		expect(onsend).not.toHaveBeenCalled();
		dom.press(field(), 'Enter', { ctrlKey: true });
		expect(onsend).toHaveBeenCalledOnce();
		// @ts-expect-error: jsdom has no editing commands; put it back as it was.
		delete document.execCommand;
		// The draft wasn't emptied (the page keeps it on a failed send): the panel stays, until Esc.
		await tick();
		expect(panel()).not.toBeNull();
		expect(dom.press(field(), 'Escape')).toBe(false);
		flushSync();
		expect(panel()).toBeNull();
	});
});
