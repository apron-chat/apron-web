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

	it('embeds the draft as an attachment from the full panel: message.md goes to its files, and the panel closes empty', async () => {
		const onfiles = vi.fn();
		const props = $state<Record<string, unknown>>({ value: '# Plan\n- canary @ada', placeholder: 'Message General', disabled: false, canUpload: true, people: [], oninput: vi.fn(), onsend: vi.fn(), onfiles, onunstage: vi.fn(), onrename: vi.fn(), oncancelreply: vi.fn() });
		dom.render(Composer, props as never);
		flushSync();
		const embed = () => document.querySelector<HTMLButtonElement>('button[aria-label="Embed as attachment"]');
		// Not in the compact composer.
		expect(embed()).toBeNull();
		document.querySelector<HTMLButtonElement>('[data-testid="composer-expand"]')!.click();
		flushSync();
		await tick();
		expect(embed()?.title).toBe('Embed as attachment');

		embed()!.click();
		flushSync();
		await tick();
		const [[files]] = onfiles.mock.calls as [[File[]]];
		expect([files.length, files[0].name, files[0].type, await files[0].text()]).toEqual([1, 'message.md', 'text/markdown', '# Plan\n- canary @ada']);
		expect([props.value, document.querySelector('[data-testid="composer-panel"]')]).toEqual(['', null]);
		expect(props.oninput).toHaveBeenCalled();
	});

	it('embeds it as a text type the server takes, where it states them', async () => {
		const onfiles = vi.fn();
		render({ value: 'one\ntwo', canUpload: true, uploadLimits: { 'image/*': {}, 'text/plain': {} }, onfiles });
		document.querySelector<HTMLButtonElement>('[data-testid="composer-expand"]')!.click();
		flushSync();
		await tick();
		document.querySelector<HTMLButtonElement>('button[aria-label="Embed as attachment"]')!.click();
		const [[files]] = onfiles.mock.calls as [[File[]]];
		expect([files[0].name, files[0].type]).toEqual(['message.md', 'text/plain']);
	});

	it('keeps a draft too large for the server, offering it so the files say why', async () => {
		const onfiles = vi.fn();
		const props = $state<Record<string, unknown>>({ value: 'one\ntwo', placeholder: 'Message General', disabled: false, canUpload: true, uploadLimits: { 'text/markdown': { max_bytes: 4 } }, people: [], oninput: vi.fn(), onsend: vi.fn(), onfiles, onunstage: vi.fn(), onrename: vi.fn(), oncancelreply: vi.fn() });
		dom.render(Composer, props as never);
		flushSync();
		document.querySelector<HTMLButtonElement>('[data-testid="composer-expand"]')!.click();
		flushSync();
		await tick();
		const embed = () => document.querySelector<HTMLButtonElement>('button[aria-label="Embed as attachment"]')!;
		embed().click();
		flushSync();
		expect((onfiles.mock.calls[0][0] as File[])[0].type).toBe('text/markdown');
		expect(props.value).toBe('one\ntwo');
		expect(document.querySelector('[data-testid="composer-panel"]')).not.toBeNull();
		// Too large for every type: offered as the one with the largest limit, so the refusal names that.
		props.uploadLimits = { 'text/markdown': { max_bytes: 4 }, 'text/plain': { max_bytes: 6 } };
		flushSync();
		embed().click();
		flushSync();
		expect((onfiles.mock.calls[1][0] as File[])[0].type).toBe('text/plain');
		expect(props.value).toBe('one\ntwo');
		// A type it fits as goes, and the draft empties.
		props.uploadLimits = { 'text/markdown': { max_bytes: 4 }, 'text/plain': {} };
		flushSync();
		embed().click();
		flushSync();
		expect((onfiles.mock.calls[2][0] as File[])[0].type).toBe('text/plain');
		expect(props.value).toBe('');
	});

	it('doesn\'t offer it without uploads, where the server takes no text, or for a command', async () => {
		for (const props of [{ value: 'one\ntwo', canUpload: false }, { value: 'one\ntwo', canUpload: true, uploadLimits: { 'image/*': {}, 'audio/*': {} } }, { value: '/me one\ntwo', canUpload: true, canCommand: true }]) {
			render(props);
			document.querySelector<HTMLButtonElement>('[data-testid="composer-expand"]')?.click();
			flushSync();
			await tick();
			expect(document.querySelector('button[aria-label="Embed as attachment"]')).toBeNull();
			dom.unmount();
		}
	});
});
