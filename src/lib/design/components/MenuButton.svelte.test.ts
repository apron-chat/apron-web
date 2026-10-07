// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte';
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

	it('as a picker, checks the selected choice, opens on it, and draws a lead before each label', async () => {
		const onselect = vi.fn();
		instance = mount(MenuButton, { target: document.body, props: { label: '8 hours', choices, onselect, selected: '8h', ariaLabel: 'Pause: 8 hours', lead: createRawSnippet((value: () => string) => ({ render: () => `<i class="lead">${value()}</i>` })) } });
		flushSync();
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

	it('keeps its items out of the tab order, and on Tab closes with focus back on the button, to move on from there', async () => {
		const { trigger } = render();
		trigger.click();
		flushSync();
		await tick();
		expect(items().map((item) => item.tabIndex)).toEqual([-1, -1, -1]);
		key(items()[1], 'ArrowDown');
		key(items()[2], 'Tab');
		flushSync();
		expect(items()).toEqual([]);
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(trigger);
	});

	it('while busy, keeps focus and stays closed instead of being disabled', async () => {
		const props = $state({ label: 'Saving…', choices, onselect: vi.fn(), busy: true });
		instance = mount(MenuButton, { target: document.body, props });
		flushSync();
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

	it('draws an icon button named by its label, and marks the items for tests', async () => {
		const icon = createRawSnippet(() => ({ render: () => '<svg aria-hidden="true"></svg>' }));
		const actions = [{ value: 'edit', label: 'Edit room', testid: 'edit-room' }, { value: 'leave', label: 'Leave room', testid: 'leave-room' }];
		instance = mount(MenuButton, { target: document.body, props: { label: 'Room actions', icon, testid: 'room-actions', choices: actions, onselect: vi.fn() } });
		flushSync();
		const trigger = document.querySelector<HTMLButtonElement>('[data-testid="room-actions"]')!;
		expect(trigger.classList.contains('ap-iconbtn')).toBe(true);
		expect(trigger.getAttribute('aria-label')).toBe('Room actions');
		expect(trigger.textContent).toBe('');
		trigger.click();
		flushSync();
		await tick();
		expect(trigger.classList.contains('ap-iconbtn-on')).toBe(true);
		expect(document.querySelector('[data-testid="leave-room"]')?.textContent).toBe('Leave room');
	});
});
