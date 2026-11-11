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
		for (const value of ['', 'one line']) {
			render({ value });
			expect(document.querySelector('[data-testid="composer-expand"]')).toBeNull();
			dom.unmount();
		}
		render({ value: '/me waves\nand more', canCommand: true });
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

	it('closes the full panel once the draft is emptied from outside (sent, from here or an ask), not by typing', async () => {
		const props = $state<Record<string, unknown>>({ value: 'one\ntwo', placeholder: 'Message General', disabled: false, canUpload: false, people: [], oninput: vi.fn(), onsend: vi.fn(), onfiles: vi.fn(), onunstage: vi.fn(), onrename: vi.fn(), oncancelreply: vi.fn() });
		dom.render(Composer, props as never);
		flushSync();
		const panel = () => document.querySelector('[data-testid="composer-panel"]');
		document.querySelector<HTMLButtonElement>('[data-testid="composer-expand"]')!.click();
		flushSync();
		await tick();
		expect(panel()).not.toBeNull();
		// Emptied by typing: the panel stays, to write in.
		const field = document.querySelector<HTMLElement>('[data-testid="message-input"]')!;
		field.replaceChildren();
		field.dispatchEvent(new InputEvent('input', { bubbles: true }));
		flushSync();
		expect(props.value).toBe('');
		expect(panel()).not.toBeNull();
		// Typed again, then emptied from outside, as a send empties it: the panel closes.
		field.append('three');
		field.dispatchEvent(new InputEvent('input', { bubbles: true }));
		flushSync();
		expect(props.value).toBe('three');
		props.value = '';
		flushSync();
		expect(panel()).toBeNull();
	});

	describe('a long paste', () => {
		/** About 1.4 KB of Markdown, pasted with Windows line breaks. */
		const LONG = Array.from({ length: 40 }, (_, n) => `${n + 1}. Promote the next slice of hosts.`).join('\r\n');
		const DRAFTED = LONG.replace(/\r\n/g, '\n');

		/** A paste of `text` on the field, which the browser has put in the draft (the props' `value`). */
		function pasteText(field: HTMLElement, text: string): void {
			const event = new Event('paste', { bubbles: true, cancelable: true });
			Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [], getData: () => text } });
			field.dispatchEvent(event);
			flushSync();
		}
		const offer = () => document.querySelector<HTMLButtonElement>('button[aria-label="Attach as file instead"]');
		/** The composer, with `props` as they are, kept reactive (`render` spreads its props into an object of its own). */
		function mount<P extends Record<string, unknown>>(props: P): HTMLElement {
			dom.render(Composer, props as never);
			flushSync();
			return document.querySelector<HTMLElement>('[data-testid="message-input"]')!;
		}
		const base = () => ({ placeholder: 'Message General', disabled: false, people: [], onsend: vi.fn(), onunstage: vi.fn(), onrename: vi.fn(), oncancelreply: vi.fn() });

		it('is offered where files can be attached, and taken, becomes pasted.md, leaving what was typed around it', async () => {
			const onfiles = vi.fn();
			const oninput = vi.fn();
			const props = $state({ ...base(), value: '', canUpload: true, onfiles, oninput });
			const field = mount(props);
			props.value = `Here is the plan: ${DRAFTED} Thoughts?`;
			pasteText(field, LONG);
			expect(offer()?.title).toBe('Send the pasted text as pasted.md (1 KB) rather than in the message');

			offer()!.click();
			flushSync();
			expect(props.value).toBe('Here is the plan:  Thoughts?');
			expect(oninput).toHaveBeenCalled();
			const [[files]] = onfiles.mock.calls as [[File[]]];
			expect([files.length, files[0].name, files[0].type]).toEqual([1, 'pasted.md', 'text/markdown']);
			expect(await files[0].text()).toBe(DRAFTED);
			expect(offer()).toBeNull();
		});

		it('isn\'t offered for a short paste, without uploads, or once the draft no longer holds what was pasted', () => {
			const props = $state({ ...base(), value: 'a short line', canUpload: true, onfiles: vi.fn(), oninput: vi.fn() });
			const field = mount(props);
			pasteText(field, 'a short line');
			expect(offer()).toBeNull();

			props.value = DRAFTED;
			pasteText(field, LONG);
			expect(offer()).not.toBeNull();
			props.value = DRAFTED.replace('1. Promote', '1. Prompt');
			flushSync();
			expect(offer()).toBeNull();
			dom.unmount();

			const off = $state({ ...base(), value: DRAFTED, canUpload: false, onfiles: vi.fn(), oninput: vi.fn() });
			pasteText(mount(off), LONG);
			expect(offer()).toBeNull();
		});
	});
});
