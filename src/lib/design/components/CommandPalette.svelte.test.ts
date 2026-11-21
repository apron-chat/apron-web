// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import CommandPalette from './CommandPalette.svelte';
import * as dom from '$lib/test/dom';

beforeAll(dom.stubDialog);

const sections = [
	{ title: 'Everyone', rows: [{ name: 'help', description: 'List the commands that you can use' }] },
	{ title: 'Roles', rows: [{ name: 'emoji' }, { name: 'emoji add', hint: ':<name>:', description: 'Add a custom emoji', form: true, unfit: 'Attach a file first' }] }
];

function render(props: Record<string, unknown> = {}) {
	dom.render(CommandPalette, { open: true, sections, ...props });
	flushSync();
	return document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
}

const options = () => [...document.querySelectorAll('[role="option"]')].map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

describe('CommandPalette', () => {
	it('lists each section under its heading, each command its /name, hint and description, a form set in, one that won’t fit greyed with why', () => {
		render();
		const dialog = document.querySelector('dialog')!;
		expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Commands');
		expect([...dialog.querySelectorAll('[role="listbox"] > [role="presentation"]')].map((heading) => heading.textContent)).toEqual(['Everyone', 'Roles']);
		expect(options()).toEqual(['/help List the commands that you can use', '/emoji', '/emoji add :<name>: Attach a file first Add a custom emoji']);
		const form = document.querySelectorAll('[role="option"]')[2];
		expect(form.classList.contains('ap-palette-form')).toBe(true);
		expect(form.classList.contains('ap-palette-unfit')).toBe(true);
	});

	it('takes ↑ ↓ and Enter in its field, picks a row by press or Enter, and closes', () => {
		const onpick = vi.fn();
		const onclose = vi.fn();
		const field = render({ onpick, onclose });
		expect(field.getAttribute('aria-activedescendant')).toMatch(/-0$/);
		dom.press(field, 'ArrowDown');
		dom.press(field, 'ArrowDown');
		dom.press(field, 'ArrowDown');
		flushSync();
		expect(field.getAttribute('aria-activedescendant')).toMatch(/-2$/);
		dom.press(field, 'Enter');
		flushSync();
		expect(onpick).toHaveBeenCalledWith('emoji add');
		expect(onclose).toHaveBeenCalledOnce();
		dom.unmount();
		const pressed = vi.fn();
		render({ onpick: pressed });
		(document.querySelectorAll('[role="option"]')[1] as HTMLElement).click();
		expect(pressed).toHaveBeenCalledWith('emoji');
	});

	it('says what an empty list means: loading, or nothing matches', () => {
		render({ sections: [], loading: true });
		expect(document.querySelector('[role="listbox"]')!.textContent).toBe('Loading commands…');
		dom.unmount();
		render({ sections: [], query: 'zap' });
		expect(document.querySelector('[role="listbox"]')!.textContent).toBe('No command matches “zap”.');
	});
});
