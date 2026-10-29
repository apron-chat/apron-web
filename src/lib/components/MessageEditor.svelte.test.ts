// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Embed } from '$lib/protocol/types';
import MessageEditor from './MessageEditor.svelte';
import * as dom from '$lib/test/dom';

const photo: Embed = { kind: 'upload', embed_id: 'e1', title: 'image.png', url: 'https://chat.test/f/1' };
const notes: Embed = { kind: 'upload', embed_id: 'e2', title: 'notes.txt', url: 'https://chat.test/f/2' };
const link: Embed = { kind: 'link', url: 'https://github.com/a/b/pull/1', og: { title: 'Fix the cert' } };

function render(props: Record<string, unknown> = {}) {
	const handlers = { onsave: vi.fn(), oncancel: vi.fn() };
	dom.render(MessageEditor, { text: 'see these', embeds: [photo, notes, link], uploads: {}, ...handlers, ...props });
	return handlers;
}

const button = (name: string) => [...document.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name)!;
const field = () => document.querySelector<HTMLElement>('[role="textbox"][aria-label="Edit message"]')!;

/** Types `text` at the end of the field, as one `input` event, the caret after it. */
function typeAtEnd(text: string) {
	field().append(text);
	const range = document.createRange();
	range.setStart(field(), field().childNodes.length);
	document.getSelection()!.removeAllRanges();
	document.getSelection()!.addRange(range);
	field().dispatchEvent(new InputEvent('input', { bubbles: true }));
	flushSync();
}

function rename(from: string, to: string, commit = 'Enter') {
	button(`Rename ${from}`).click();
	flushSync();
	const input = document.querySelector<HTMLInputElement>('input[aria-label="File name"]')!;
	input.value = to;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	dom.press(input, commit);
	flushSync();
}

describe('MessageEditor', () => {
	it('shows the text and every embed, uploads renamable, and saves text and embed changes together', () => {
		const { onsave, oncancel } = render();
		expect(field().textContent).toBe('see these');
		expect(document.activeElement).toBe(field());
		expect([...document.querySelectorAll('[data-testid="edit-attachment"]')].map((tile) => tile.querySelector('.ap-attachment-name, .ap-embed-title')?.textContent)).toEqual(['image.png', 'notes.txt', 'Fix the cert']);
		expect(button('Rename Fix the cert')).toBeUndefined();

		// The whole name changes, extension and all; Enter and Escape in it stay with the rename.
		rename('image.png', 'dusk over the ridge');
		rename('notes.txt', 'ignored', 'Escape');
		expect(oncancel).not.toHaveBeenCalled();
		expect(button('Rename dusk over the ridge')).toBeDefined();
		button('Remove Fix the cert').click();
		flushSync();
		button('Save changes').click();
		expect(onsave).toHaveBeenCalledWith('see these', { removed: [link], renamed: [{ embed: photo, title: 'dusk over the ridge' }] }, []);
	});

	it('closes without saving when nothing changed, cancels on Escape, and saves text alone without embed edits', () => {
		let { onsave, oncancel } = render();
		dom.press(field(), 'Enter');
		expect(onsave).not.toHaveBeenCalled();
		expect(oncancel).toHaveBeenCalledTimes(1);
		dom.press(field(), 'Escape');
		expect(oncancel).toHaveBeenCalledTimes(2);
		dom.unmount();
		({ onsave, oncancel } = render());
		field().textContent = 'new words';
		field().dispatchEvent(new InputEvent('input', { bubbles: true }));
		dom.press(field(), 'Enter');
		expect(onsave).toHaveBeenCalledWith('new words', undefined, []);
	});

	it('needs text or an embed to save, and keeps an upload being written', () => {
		render({ text: '', embeds: [photo, notes], uploads: { e2: { name: 'notes.txt', progress: 0.5 } } });
		expect(button('Remove notes.txt')).toBeUndefined();
		button('Remove image.png').click();
		flushSync();
		expect(button('Save changes').disabled).toBe(false);
		dom.unmount();
		render({ text: '', embeds: [photo] });
		button('Remove image.png').click();
		flushSync();
		expect(button('Save changes').disabled).toBe(true);
	});

	it('writes as the composer does: mentions as chips, and @ autocompletes people, whose Escape keeps the editor open', () => {
		const people = [{ id: 'ada', name: 'Ada Lovelace' }, { id: 'alan', name: 'Alan Turing' }];
		const { onsave, oncancel } = render({ text: '@ada see these', embeds: [], people });
		expect(field().querySelector('[data-user-id="ada"]')?.textContent).toBe('@Ada Lovelace');

		typeAtEnd(' cc @al');
		const options = () => [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
		expect(options()).toEqual([expect.stringContaining('Alan Turing')]);
		expect(field().getAttribute('aria-controls')).toBeTruthy();
		// Escape closes the picker, not the editor.
		dom.press(field(), 'Escape');
		flushSync();
		expect(options()).toEqual([]);
		expect(oncancel).not.toHaveBeenCalled();

		// Typing on opens it again.
		typeAtEnd('a');
		expect(options()).toEqual([expect.stringContaining('Alan Turing')]);
		dom.press(field(), 'Tab');
		flushSync();
		expect(field().querySelector('[data-user-id="alan"]')?.textContent).toBe('@Alan Turing');

		dom.press(field(), 'Enter');
		expect(onsave).toHaveBeenCalledWith('@ada see these cc @alan ', undefined, ['ada', 'alan']);
	});

	it('opens a message as written: a name in plain text stays text, and nothing changed cancels', () => {
		const { onsave, oncancel } = render({ text: '@Ada Lovelace hi @ada', embeds: [], people: [{ id: 'ada', name: 'Ada Lovelace' }] });
		// Only the `@user_id` is a chip, the last word as well.
		expect([...field().querySelectorAll('[data-user-id]')].map((chip) => chip.textContent)).toEqual(['@Ada Lovelace']);
		expect(field().textContent).toBe('@Ada Lovelace hi @Ada Lovelace');
		dom.press(field(), 'Enter');
		expect(onsave).not.toHaveBeenCalled();
		expect(oncancel).toHaveBeenCalledOnce();
	});

	it('saves who its chips mention: one it can\u2019t name stays from the message, and a chip backspaced into text is no mention', () => {
		// Bob isn't among the people here, but the message mentions him.
		const { onsave } = render({ text: 'hi @bob and @ada', embeds: [photo], mentions: ['bob', 'ada'], people: [{ id: 'ada', name: 'Ada Lovelace' }] });
		expect(field().querySelector('[data-user-id="bob"]')).not.toBeNull();
		button('Remove image.png').click();
		flushSync();
		button('Save changes').click();
		expect(onsave).toHaveBeenLastCalledWith('hi @bob and @ada', { removed: [photo] }, ['bob', 'ada']);

		// Backspace right after Ada's chip turns it back into text.
		const range = document.createRange();
		range.setStart(field(), field().childNodes.length);
		document.getSelection()!.removeAllRanges();
		document.getSelection()!.addRange(range);
		field().dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
		flushSync();
		expect(field().querySelector('[data-user-id="ada"]')).toBeNull();
		button('Save changes').click();
		expect(onsave).toHaveBeenLastCalledWith('hi @bob and @Ada Lovelace', { removed: [photo] }, ['bob']);
	});
});
