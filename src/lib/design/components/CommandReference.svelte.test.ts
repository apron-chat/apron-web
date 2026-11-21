// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import CommandReference from './CommandReference.svelte';
import * as dom from '$lib/test/dom';

beforeAll(dom.stubDialog);

const sections = [
	{ title: 'Everyone', commands: [{ name: 'help', description: 'List the commands that you can use' }] },
	{ title: 'Roles', commands: [{ name: 'emoji add', hint: ':<name>:', description: 'Add a custom emoji', required: ['attachment', 'reply'] }, { name: 'emoji remove', hint: ':<name>:', description: 'Remove a custom emoji' }] }
];

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, ' ').trim();

describe('CommandReference', () => {
	it('reads as a document: a heading per section, each command, a form like any, its /name and hint as code, its description and a label of what it requires', () => {
		dom.render(CommandReference, { open: true, sections });
		flushSync();
		const dialog = document.querySelector('dialog')!;
		expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Commands');
		expect([...dialog.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual(['Everyone', 'Roles']);
		expect([...dialog.querySelectorAll('dt')].map((term) => text(term))).toEqual(['/help', '/emoji add :<name>:', '/emoji remove :<name>:']);
		expect([...dialog.querySelectorAll('dt code')].map((code) => text(code))).toEqual(['/help', '/emoji add :<name>:', '/emoji remove :<name>:']);
		const entry = dialog.querySelectorAll('dl > div')[1];
		expect([...entry.querySelectorAll('dd')].map((detail) => text(detail))).toEqual(['Add a custom emoji', 'Required: attachment, reply']);
		// Without a requirement, no label.
		expect(dialog.querySelectorAll('dl > div')[2].querySelectorAll('dd')).toHaveLength(1);
	});

	it('crosses out one of apron-web’s own that the server’s command of the same name replaces, says so, and offers no use of it', () => {
		dom.render(CommandReference, { open: true, onuse: vi.fn(), sections: [{ title: 'Built into the client', commands: [{ name: 'kick', hint: '@user', description: 'Remove a user from this room', replaced: true }] }] });
		flushSync();
		const entry = document.querySelector('dialog dl > div')!;
		expect(entry.querySelector('dt s')?.textContent).toBe('/kick @user');
		expect([...entry.querySelectorAll('dd')].map((detail) => text(detail))).toEqual(['Remove a user from this room', 'Replaced by the server’s /kick']);
		expect(entry.querySelector('button')).toBeNull();
	});

	it('says while the commands are on their way, or why they won’t come, and closes with its close button, saying so', () => {
		const onclose = vi.fn();
		dom.render(CommandReference, { open: true, sections: [], loading: true, onclose });
		flushSync();
		expect(document.querySelector('dialog')!.textContent).toContain('Loading commands…');
		dom.unmount();
		dom.render(CommandReference, { open: true, sections: [], error: 'The commands couldn’t be loaded.', onclose });
		flushSync();
		expect(document.querySelector('dialog')!.textContent).toContain('The commands couldn’t be loaded.');
		dom.button('Close').click();
		flushSync();
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('with onuse, makes each command’s code a button that uses it, by name, and closes', () => {
		const onuse = vi.fn();
		const onclose = vi.fn();
		dom.render(CommandReference, { open: true, sections, onuse, onclose });
		flushSync();
		// In document order, as Tab goes through them; named for what they do, with what they show (WCAG 2.5.3).
		expect([...document.querySelectorAll('dt button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Use /help', 'Use /emoji add :<name>:', 'Use /emoji remove :<name>:']);
		expect(text(document.querySelectorAll('dt button')[1])).toBe('/emoji add :<name>:');
		dom.button('Use /emoji add :<name>:').click();
		flushSync();
		expect(onuse).toHaveBeenCalledWith('emoji add');
		expect(onclose).toHaveBeenCalledOnce();
		dom.unmount();
		// Without it, there's nothing to press.
		dom.render(CommandReference, { open: true, sections });
		flushSync();
		expect(document.querySelectorAll('dt button')).toHaveLength(0);
	});
});

