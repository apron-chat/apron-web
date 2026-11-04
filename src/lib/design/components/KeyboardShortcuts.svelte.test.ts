// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import KeyboardShortcuts from './KeyboardShortcuts.svelte';
import * as dom from '$lib/test/dom';

beforeAll(dom.stubDialog);

const groups = [
	{ title: 'General', shortcuts: [{ label: 'Search local history', keys: [['⌘', 'F']] }, { label: 'Show keyboard shortcuts', keys: [['?'], ['⌘', '/']] }] },
	{ title: 'Composer', shortcuts: [{ label: 'Edit your last message', where: 'In an empty composer', keys: [['↑']] }] }
];

describe('KeyboardShortcuts', () => {
	it('lists each group under its heading, each shortcut beside its keys, and names the keys in words', () => {
		dom.render(KeyboardShortcuts, { open: true, groups });
		flushSync();
		const dialog = document.querySelector('dialog')!;
		expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Keyboard shortcuts');
		expect([...dialog.querySelectorAll('h3')].map((heading) => heading.textContent)).toEqual(['General', 'Composer']);
		const rows = [...dialog.querySelectorAll('.ap-keys-row')];
		expect(rows.map((row) => row.querySelector('dt')!.textContent)).toEqual(['Search local history', 'Show keyboard shortcuts', 'Edit your last messageIn an empty composer']);
		// A combination is a <kbd> of <kbd>s, hidden from a screen reader, which hears it in words; alternatives are joined by "or".
		const show = rows[1].querySelector('dd')!;
		expect([...show.querySelectorAll('.ap-keys-combo')].map((combo) => [...combo.querySelectorAll('kbd')].map((key) => key.textContent))).toEqual([['?'], ['⌘', '/']]);
		expect(show.querySelector('.ap-keys-combo')!.getAttribute('aria-hidden')).toBe('true');
		expect([...show.querySelectorAll('.ap-sr')].map((words) => words.textContent)).toEqual(['Question mark', 'Command Slash']);
		expect(show.querySelector('.ap-keys-or')!.textContent).toBe('or');
		expect(rows[2].querySelector('.ap-sr')!.textContent).toBe('Up arrow');
	});

	it('closes with its close button, saying so', () => {
		const onclose = vi.fn();
		dom.render(KeyboardShortcuts, { open: true, groups, onclose });
		flushSync();
		dom.button('Close').click();
		flushSync();
		expect(onclose).toHaveBeenCalledOnce();
	});
});
