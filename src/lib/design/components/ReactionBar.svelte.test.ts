// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReactionBar from './ReactionBar.svelte';

let instance: ReturnType<typeof mount> | undefined;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	if (instance) unmount(instance);
	instance = undefined;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

function render(props: Record<string, unknown> = {}) {
	const ontoggle = vi.fn();
	const onreactors = vi.fn();
	instance = mount(ReactionBar, { target: document.body, props: { reactions: [{ emoji: '👍', count: 2, mine: true, who: 'You and Ada' }], ontoggle, onreactors, chipTestid: 'chip', ...props } });
	flushSync();
	return { chip: document.querySelector<HTMLButtonElement>('[data-testid="chip"]')!, ontoggle, onreactors };
}

function touch(type: string, target: Element, y = 0): void {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: y, detail: 1 });
	Object.defineProperty(event, 'pointerType', { value: 'touch' });
	target.dispatchEvent(event);
}

describe('ReactionBar', () => {
	it('labels a chip from who reacted, or from the title and label given', () => {
		let { chip } = render();
		expect([chip.title, chip.getAttribute('aria-label'), chip.dataset.emoji]).toEqual(['You and Ada reacted with 👍', '👍 2, including yours. Remove yours', '👍']);
		unmount(instance!);
		({ chip } = render({ reactions: [{ emoji: '🎉', count: 1, title: 'Ada reacted', label: '1 reaction with 🎉' }] }));
		expect([chip.title, chip.getAttribute('aria-label')]).toEqual(['Ada reacted', '1 reaction with 🎉']);
	});

	it('shows who reacted on a right-click or a long press, and the click that ends a long press does not toggle', () => {
		const { chip, ontoggle, onreactors } = render();
		const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		chip.dispatchEvent(menu);
		expect(menu.defaultPrevented).toBe(true);
		expect(onreactors).toHaveBeenLastCalledWith('👍', chip);

		onreactors.mockClear();
		touch('pointerdown', chip);
		vi.advanceTimersByTime(500);
		expect(onreactors).toHaveBeenCalledWith('👍', chip);
		touch('pointerup', chip);
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(ontoggle).not.toHaveBeenCalled();

		// A touch that moves is a scroll; a tap toggles.
		onreactors.mockClear();
		touch('pointerdown', chip);
		touch('pointermove', chip, 30);
		vi.advanceTimersByTime(500);
		expect(onreactors).not.toHaveBeenCalled();
		touch('pointerup', chip);
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(ontoggle).toHaveBeenCalledWith('👍');
	});

	it('keeps the context menu without onreactors', () => {
		const { chip } = render({ onreactors: undefined });
		const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		chip.dispatchEvent(menu);
		expect(menu.defaultPrevented).toBe(false);
	});

	it('leaves disabled chips focusable and showing who reacted, without toggling or the + button', () => {
		const { chip, ontoggle, onreactors } = render({ disabled: true });
		expect(chip.disabled).toBe(false);
		expect(chip.getAttribute('aria-disabled')).toBe('true');
		chip.click();
		expect(ontoggle).not.toHaveBeenCalled();
		chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(onreactors).toHaveBeenCalledOnce();
		expect(document.querySelector('.ap-rchip-add')).toBeNull();
	});

	it('shows the + button unless add is false', () => {
		render();
		expect(document.querySelector('.ap-rchip-add')).not.toBeNull();
		unmount(instance!);
		render({ add: false });
		expect(document.querySelector('.ap-rchip-add')).toBeNull();
	});
});
