// @vitest-environment jsdom
import { flushSync, tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu.svelte';
import { hold } from './hold';
import * as dom from '$lib/test/dom';

const choices = [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two', danger: true }];

describe('ContextMenu', () => {
	it('opens at its point, focused itself, moves with the arrows, and closes on a choice, Tab or a press elsewhere', async () => {
		const back = document.body.appendChild(document.createElement('button'));
		const state = $state({ open: true, x: 20, y: 30 });
		const onselect = vi.fn();
		dom.render(ContextMenu, { get open() { return state.open; }, set open(v: boolean) { state.open = v; }, x: 20, y: 30, label: 'Bo', choices, onselect, returnFocus: back } as never);
		flushSync();
		await tick();
		const menu = dom.byRole('menu', 'Bo');
		// Opened by a pointer, the menu takes focus, not its first choice: no ring on it.
		expect([menu.style.left, menu.style.top, document.activeElement]).toEqual(['20px', '30px', menu]);
		expect(dom.byRole('menuitem', 'Two').classList.contains('ap-menu-item-danger')).toBe(true);
		dom.press(menu, 'ArrowDown');
		expect(document.activeElement?.textContent).toBe('One');
		dom.press(menu, 'ArrowDown');
		expect(document.activeElement?.textContent).toBe('Two');
		dom.press(menu, 'ArrowDown');
		expect(document.activeElement?.textContent).toBe('One');
		dom.press(menu, 'End');
		(document.activeElement as HTMLElement).click();
		flushSync();
		expect([onselect.mock.calls, state.open, document.activeElement]).toEqual([[['two']], false, back]);
		state.open = true;
		flushSync();
		await tick();
		dom.press(dom.byRole('menu'), 'Tab');
		flushSync();
		expect(state.open).toBe(false);
		state.open = true;
		flushSync();
		document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
		flushSync();
		expect(state.open).toBe(false);
		back.remove();
	});

	it('focuses its first choice when opened from the keyboard', async () => {
		dom.render(ContextMenu, { open: true, x: 0, y: 0, keyboard: true, label: 'Bo', choices, onselect: vi.fn() } as never);
		flushSync();
		await tick();
		expect(document.activeElement?.textContent).toBe('One');
	});

	it('stays inside the viewport, and opens leftward from its point under rtl', async () => {
		// jsdom lays nothing out: give the menu a size to place.
		const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 160, height: 90, top: 0, left: 0, right: 160, bottom: 90, x: 0, y: 0, toJSON: () => ({}) });
		dom.render(ContextMenu, { open: true, x: innerWidth - 20, y: innerHeight - 10, label: 'Bo', choices, onselect: vi.fn() } as never);
		flushSync();
		let menu = dom.byRole('menu');
		expect([menu.style.left, menu.style.top]).toEqual([`${innerWidth - 160 - 8}px`, `${innerHeight - 90 - 8}px`]);
		dom.unmount();
		document.documentElement.dir = 'rtl';
		dom.render(ContextMenu, { open: true, x: 300, y: 40, label: 'Bo', choices, onselect: vi.fn() } as never);
		flushSync();
		menu = dom.byRole('menu');
		expect([menu.style.left, menu.style.top]).toEqual(['140px', '40px']);
		document.documentElement.dir = '';
		rect.mockRestore();
	});

	it('steps ↑ to its last choice from the menu itself, keeps its keys from the page, names itself, and closes on a scroll', async () => {
		const state = $state({ open: true });
		const onpage = vi.fn();
		addEventListener('keydown', onpage);
		dom.render(ContextMenu, { get open() { return state.open; }, set open(v: boolean) { state.open = v; }, x: 0, y: 0, id: 'm1', label: 'Bo', choices: [...choices, { value: 'three', label: 'Three' }], onselect: vi.fn() } as never);
		flushSync();
		await tick();
		const menu = dom.byRole('menu');
		expect(menu.id).toBe('m1');
		dom.press(menu, 'ArrowUp');
		expect(document.activeElement?.textContent).toBe('Three');
		dom.press(menu, 'Escape');
		flushSync();
		expect([state.open, onpage.mock.calls.length]).toEqual([false, 0]);
		removeEventListener('keydown', onpage);
		state.open = true;
		flushSync();
		document.body.dispatchEvent(new Event('scroll'));
		flushSync();
		expect(state.open).toBe(false);
	});
});

describe('hold', () => {
	const node = () => {
		const element = document.body.appendChild(document.createElement('div'));
		const onhold = vi.fn();
		const cleanup = hold(onhold)(element) as () => void;
		return { element, onhold, cleanup };
	};

	it('holds on a long touch press, not one that drifts past SLOP_PX or lifts early, and swallows the click that ends it', () => {
		vi.useFakeTimers();
		const { element, onhold, cleanup } = node();
		const click = vi.fn();
		element.addEventListener('click', click);
		dom.touch('pointerdown', element, 10, 10);
		dom.touch('pointermove', element, 18, 14);
		vi.advanceTimersByTime(500);
		expect(onhold).toHaveBeenCalledWith({ x: 10, y: 10 }, element);
		element.click();
		expect(click).not.toHaveBeenCalled();
		dom.touch('pointerdown', element, 10, 10);
		dom.touch('pointermove', element, 25, 10);
		vi.advanceTimersByTime(500);
		dom.touch('pointerdown', element, 10, 10);
		dom.touch('pointerup', element, 10, 10);
		vi.advanceTimersByTime(500);
		expect(onhold).toHaveBeenCalledOnce();
		element.click();
		expect(click).toHaveBeenCalledOnce();
		vi.useRealTimers();
		cleanup();
		element.remove();
	});

	it('holds on a right-click where it was, or the context menu key at the element, unless onhold declines', () => {
		const { element, onhold, cleanup } = node();
		const menu = (x: number, y: number) => {
			const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
			element.dispatchEvent(event);
			return event.defaultPrevented;
		};
		expect(menu(40, 50)).toBe(true);
		expect(onhold).toHaveBeenLastCalledWith({ x: 40, y: 50 }, element);
		menu(0, 0);
		expect(onhold).toHaveBeenLastCalledWith({ x: 8, y: 0, keyboard: true }, element);
		onhold.mockReturnValue(false);
		expect(menu(40, 50)).toBe(false);
		cleanup();
		element.remove();
	});

	it('knows Chromium\'s context menu key (no pointerType) for the keyboard, placing it at the start corner under rtl too', () => {
		const { element, onhold, cleanup } = node();
		vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 300, top: 10, bottom: 40, width: 200, height: 30, x: 100, y: 10, toJSON: () => ({}) });
		const keyed = (pointerType: string) => {
			const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 150, clientY: 20 });
			Object.defineProperty(event, 'pointerType', { value: pointerType });
			element.dispatchEvent(event);
		};
		keyed('');
		expect(onhold).toHaveBeenLastCalledWith({ x: 108, y: 40, keyboard: true }, element);
		keyed('mouse');
		expect(onhold).toHaveBeenLastCalledWith({ x: 150, y: 20 }, element);
		element.dir = 'rtl';
		keyed('');
		expect(onhold).toHaveBeenLastCalledWith({ x: 292, y: 40, keyboard: true }, element);
		cleanup();
		element.remove();
	});

	it('swallows a click only after a touch: a tap earlier doesn\'t make a later mouse or keyboard menu eat one', () => {
		vi.useFakeTimers();
		const { element, cleanup } = node();
		const click = vi.fn();
		element.addEventListener('click', click);
		dom.touch('pointerdown', element, 10, 10);
		dom.touch('pointerup', element, 10, 10);
		element.click();
		const right = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
		Object.defineProperty(right, 'pointerType', { value: 'mouse' });
		element.dispatchEvent(right);
		element.click();
		expect(click).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
		cleanup();
		element.remove();
	});
});
