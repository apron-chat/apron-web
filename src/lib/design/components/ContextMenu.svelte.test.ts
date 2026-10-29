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

	it('stays inside the viewport', async () => {
		dom.render(ContextMenu, { open: true, x: innerWidth - 5, y: innerHeight - 5, label: 'Bo', choices, onselect: vi.fn() } as never);
		flushSync();
		const menu = dom.byRole('menu');
		// jsdom lays nothing out (0 × 0), so only the margin keeps it in.
		expect([parseFloat(menu.style.left) <= innerWidth - 8, parseFloat(menu.style.top) <= innerHeight - 8]).toEqual([true, true]);
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
});
