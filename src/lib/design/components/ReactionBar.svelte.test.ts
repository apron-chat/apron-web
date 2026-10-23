// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReactionBar from './ReactionBar.svelte';
import * as dom from '$lib/test/dom';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
});

function render(props: Record<string, unknown> = {}) {
	const ontoggle = vi.fn();
	const onreactors = vi.fn();
	dom.render(ReactionBar, { reactions: [{ emoji: '👍', count: 2, mine: true, who: 'You and Ada' }], ontoggle, onreactors, ...props });
	return { chip: dom.byRole('group', 'Reactions').querySelector<HTMLButtonElement>('button[data-emoji]')!, ontoggle, onreactors };
}

describe('ReactionBar', () => {
	it('labels a chip from who reacted, or from the title and label given', () => {
		let { chip } = render();
		expect([chip.title, chip.getAttribute('aria-label'), chip.dataset.emoji]).toEqual(['You and Ada reacted with 👍', '👍 2, including yours. Remove yours', '👍']);
		dom.unmount();
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
		dom.touch('pointerdown', chip);
		vi.advanceTimersByTime(500);
		expect(onreactors).toHaveBeenCalledWith('👍', chip);
		dom.touch('pointerup', chip);
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(ontoggle).not.toHaveBeenCalled();

		// A touch that moves is a scroll; a tap toggles.
		onreactors.mockClear();
		dom.touch('pointerdown', chip);
		dom.touch('pointermove', chip, 0, 30);
		vi.advanceTimersByTime(500);
		expect(onreactors).not.toHaveBeenCalled();
		dom.touch('pointerup', chip);
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
		expect(dom.queryByRole('button', 'Add a reaction')).toBeNull();
	});

	it('shows the + button unless add is false', () => {
		render();
		expect(dom.queryByRole('button', 'Add a reaction')).not.toBeNull();
		dom.unmount();
		render({ add: false });
		expect(dom.queryByRole('button', 'Add a reaction')).toBeNull();
	});
});
