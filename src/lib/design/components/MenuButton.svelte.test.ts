// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MenuButton from './MenuButton.svelte';

const choices = [
	{ value: '1h', label: 'For 1 hour', hint: 'until 14:30' },
	{ value: '8h', label: 'For 8 hours' },
	{ value: 'resume', label: 'Until I resume' }
];

let instance: ReturnType<typeof mount> | undefined;

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
});

function render(onselect = vi.fn()) {
	instance = mount(MenuButton, { target: document.body, props: { label: 'Pause…', choices, onselect } });
	flushSync();
	return { trigger: document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!, onselect };
}

const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const key = (target: Element, name: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

describe('MenuButton', () => {
	it('opens on click with the first choice focused, and chooses one', async () => {
		const { trigger, onselect } = render();
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		trigger.click();
		flushSync();
		await tick();
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Pause…');
		expect(items().map((item) => item.textContent)).toEqual(['For 1 houruntil 14:30', 'For 8 hours', 'Until I resume']);
		expect(document.activeElement).toBe(items()[0]);
		items()[1].click();
		flushSync();
		expect(onselect).toHaveBeenCalledWith('8h');
		expect(items()).toEqual([]);
		expect(document.activeElement).toBe(trigger);
	});

	it('opens from the keyboard with the arrows, moves through the choices, and closes with Escape', async () => {
		const { trigger } = render();
		trigger.focus();
		key(trigger, 'ArrowUp');
		flushSync();
		await tick();
		expect(document.activeElement).toBe(items()[2]);
		key(items()[2], 'ArrowDown');
		expect(document.activeElement).toBe(items()[0]);
		key(items()[0], 'End');
		expect(document.activeElement).toBe(items()[2]);
		key(items()[2], 'Escape');
		flushSync();
		expect(items()).toEqual([]);
		expect(document.activeElement).toBe(trigger);
		key(trigger, 'ArrowDown');
		flushSync();
		await tick();
		expect(document.activeElement).toBe(items()[0]);
	});
});
