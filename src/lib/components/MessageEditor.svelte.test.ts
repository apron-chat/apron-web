// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Embed } from '$lib/protocol/types';
import MessageEditor from './MessageEditor.svelte';

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

const photo: Embed = { kind: 'upload', embed_id: 'e1', title: 'image.png', url: 'https://chat.test/f/1' };
const notes: Embed = { kind: 'upload', embed_id: 'e2', title: 'notes.txt', url: 'https://chat.test/f/2' };
const link: Embed = { kind: 'link', url: 'https://github.com/a/b/pull/1', og: { title: 'Fix the cert' } };

function render(props: Record<string, unknown> = {}) {
	const handlers = { onsave: vi.fn(), oncancel: vi.fn() };
	instance = mount(MessageEditor, { target: document.body, props: { text: 'see these', embeds: [photo, notes, link], uploads: {}, ...handlers, ...props } });
	flushSync();
	return handlers;
}

const button = (name: string) => [...document.querySelectorAll('button')].find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name)!;
const field = () => document.querySelector<HTMLTextAreaElement>('textarea')!;
const key = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

function rename(from: string, to: string, commit = 'Enter') {
	button(`Rename ${from}`).click();
	flushSync();
	const input = document.querySelector<HTMLInputElement>('input[aria-label="File name"]')!;
	input.value = to;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	key(input, commit);
	flushSync();
}

describe('MessageEditor', () => {
	it('shows the text and every embed, uploads renamable, and saves text and embed changes together', () => {
		const { onsave, oncancel } = render();
		expect(field().value).toBe('see these');
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
		expect(onsave).toHaveBeenCalledWith('see these', { removed: [link], renamed: [{ embed: photo, title: 'dusk over the ridge' }] });
	});

	it('closes without saving when nothing changed, cancels on Escape, and saves text alone without embed edits', () => {
		let { onsave, oncancel } = render();
		key(field(), 'Enter');
		expect(onsave).not.toHaveBeenCalled();
		expect(oncancel).toHaveBeenCalledTimes(1);
		key(field(), 'Escape');
		expect(oncancel).toHaveBeenCalledTimes(2);
		unmount(instance!);
		({ onsave, oncancel } = render());
		field().value = 'new words';
		field().dispatchEvent(new Event('input', { bubbles: true }));
		key(field(), 'Enter');
		expect(onsave).toHaveBeenCalledWith('new words', undefined);
	});

	it('needs text or an embed to save, and keeps an upload being written', () => {
		render({ text: '', embeds: [photo, notes], uploads: { e2: { name: 'notes.txt', progress: 0.5 } } });
		expect(button('Remove notes.txt')).toBeUndefined();
		button('Remove image.png').click();
		flushSync();
		expect(button('Save changes').disabled).toBe(false);
		unmount(instance!);
		render({ text: '', embeds: [photo] });
		button('Remove image.png').click();
		flushSync();
		expect(button('Save changes').disabled).toBe(true);
	});
});
