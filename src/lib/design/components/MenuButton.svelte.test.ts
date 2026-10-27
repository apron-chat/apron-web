// @vitest-environment jsdom
import { createRawSnippet, flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import MenuButton from './MenuButton.svelte';
import * as dom from '$lib/test/dom';

const choices = [
	{ value: '1h', label: 'For 1 hour', hint: 'until 14:30' },
	{ value: '8h', label: 'For 8 hours' },
	{ value: 'resume', label: 'Until I resume' }
];

function render(onselect = vi.fn()) {
	dom.render(MenuButton, { label: 'Pause…', choices, onselect });
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

	it('opens from the keyboard with the arrows, moves through the choices, and closes with Escape, or Tab, its items out of the tab order', async () => {
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
		// Its items are out of the tab order: Tab closes it with focus back on the button, to move on from there.
		expect(items().map((item) => item.tabIndex)).toEqual([-1, -1, -1]);
		key(items()[0], 'ArrowDown');
		key(items()[1], 'Tab');
		flushSync();
		expect(items()).toEqual([]);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(trigger);
	});

	it('as a picker, checks the selected choice, opens on it, and draws a lead before each label', async () => {
		const onselect = vi.fn();
		dom.render(MenuButton, { label: '8 hours', choices, onselect, selected: '8h', ariaLabel: 'Pause: 8 hours', lead: createRawSnippet((value: () => string) => ({ render: () => `<i class="lead">${value()}</i>` })) });
		const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
		expect(trigger.getAttribute('aria-label')).toBe('Pause: 8 hours');
		trigger.click();
		flushSync();
		await tick();
		const radios = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
		expect(radios.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
		expect(radios[1].classList.contains('ap-menu-item-on')).toBe(true);
		expect(document.activeElement).toBe(radios[1]);
		expect([...document.querySelectorAll('.ap-menu-label > .ap-menu-lead > i.lead')].map((lead) => lead.textContent)).toEqual(['1h', '8h', 'resume']);
		expect(document.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe('Pause: 8 hours');
		radios[2].click();
		expect(onselect).toHaveBeenCalledWith('resume');
	});

	it('while busy, keeps focus and stays closed instead of being disabled', async () => {
		const props = $state({ label: 'Saving…', choices, onselect: vi.fn(), busy: true });
		dom.render(MenuButton, props);
		const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
		trigger.focus();
		expect(trigger.disabled).toBe(false);
		expect(trigger.getAttribute('aria-disabled')).toBe('true');
		trigger.click();
		key(trigger, 'ArrowDown');
		flushSync();
		await tick();
		expect(items()).toEqual([]);
		expect(document.activeElement).toBe(trigger);
		props.busy = false;
		flushSync();
		expect(trigger.hasAttribute('aria-disabled')).toBe(false);
		trigger.click();
		flushSync();
		await tick();
		expect(items()).toHaveLength(3);
	});

	it('draws an icon button named by its label, on while open', async () => {
		const icon = createRawSnippet(() => ({ render: () => '<svg aria-hidden="true"></svg>' }));
		const actions = [{ value: 'edit', label: 'Edit room' }, { value: 'leave', label: 'Leave room' }];
		dom.render(MenuButton, { label: 'Room actions', icon, choices: actions, onselect: vi.fn() });
		const trigger = dom.button('Room actions');
		expect([trigger.classList.contains('ap-iconbtn'), trigger.textContent]).toEqual([true, '']);
		trigger.click();
		flushSync();
		await tick();
		expect(trigger.classList.contains('ap-iconbtn-on')).toBe(true);
		expect(items().map((item) => item.textContent)).toEqual(['Edit room', 'Leave room']);
	});

	it('takes a class on its box beside its own', () => {
		dom.render(MenuButton, { label: 'Pause…', choices, onselect: vi.fn(), class: 'mine' });
		expect(dom.button('Pause…').parentElement!.classList.contains('mine')).toBe(true);
	});

	it('opens a submenu beneath its item, by click or →, chooses from it, and closes it with ← or Escape', async () => {
		const onselect = vi.fn();
		const actions = [
			{ value: 'link', label: 'Copy link' },
			{ value: 'mute', label: 'Mute room', choices: [{ value: 'mute:1h', label: 'For 1 hour', hint: 'until 14:30' }, { value: 'mute:forever', label: 'Until I unmute' }] },
			{ value: 'leave', label: 'Leave room' }
		];
		dom.render(MenuButton, { label: 'Room actions', choices: actions, onselect });
		const trigger = dom.button('Room actions');
		trigger.click();
		flushSync();
		await tick();
		const opener = () => document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"].ap-menu-item')!;
		expect([opener().textContent, opener().getAttribute('aria-expanded')]).toEqual(['Mute room', 'false']);
		expect(items()).toHaveLength(3);
		// A click opens it, the item staying in the menu, its choices focused from the first, and is no choice itself.
		opener().click();
		flushSync();
		await tick();
		expect(opener().getAttribute('aria-expanded')).toBe('true');
		expect(document.querySelector('.ap-menu-sub')?.getAttribute('aria-label')).toBe('Mute room');
		expect(items().map((item) => item.textContent)).toEqual(['Copy link', 'Mute room', 'For 1 houruntil 14:30', 'Until I unmute', 'Leave room']);
		expect(document.activeElement).toBe(items()[2]);
		expect(onselect).not.toHaveBeenCalled();
		// ← closes it, back on its item; → opens it again.
		key(items()[2], 'ArrowLeft');
		flushSync();
		await tick();
		expect([items().length, document.activeElement]).toEqual([3, opener()]);
		key(opener(), 'ArrowRight');
		flushSync();
		await tick();
		expect(document.activeElement).toBe(items()[2]);
		// Escape in it closes only it.
		key(items()[3], 'Escape');
		flushSync();
		await tick();
		expect([items().length, document.activeElement]).toEqual([3, opener()]);
		key(opener(), 'ArrowRight');
		flushSync();
		await tick();
		items()[3].click();
		flushSync();
		expect(onselect).toHaveBeenCalledWith('mute:forever');
		expect(items()).toEqual([]);
		expect(document.activeElement).toBe(trigger);
		// It opens closed again.
		trigger.click();
		flushSync();
		await tick();
		expect(items()).toHaveLength(3);
	});
});
