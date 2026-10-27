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

	it('draws a key as its image or, unknown, as a placeholder, and toggles it as written (§4.7)', () => {
		const { ontoggle } = render({ reactions: [
			{ emoji: ':partyparrot:', count: 1, image: { src: 'https://e.example/p.gif', alt: 'Parrot', width: 2, height: 1 }, title: 'Ada reacted with Parrot' },
			{ emoji: ':blob:', count: 1, placeholder: true, title: 'Ada reacted with :blob:' }
		] });
		const [parrot, blob] = dom.byRole('group', 'Reactions').querySelectorAll<HTMLButtonElement>('button[data-emoji]');
		const img = parrot.querySelector<HTMLImageElement>('img.ap-cemoji')!;
		expect([img.getAttribute('src'), img.alt, img.style.aspectRatio]).toEqual(['https://e.example/p.gif', '', '2 / 1']);
		expect(blob.querySelector('.ap-rchip-placeholder')).not.toBeNull();
		expect([blob.textContent, blob.title]).toEqual(['1', 'Ada reacted with :blob:']);
		blob.click();
		expect(ontoggle).toHaveBeenLastCalledWith(':blob:');
	});

	it('shows who reacted on a right-click or a long press, where it can, and the click that ends a long press does not toggle', () => {
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
		dom.unmount();
		// Without onreactors, the context menu is the browser's.
		const plain = render({ onreactors: undefined }).chip;
		const kept = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		plain.dispatchEvent(kept);
		expect(kept.defaultPrevented).toBe(false);
	});

	it('leaves disabled chips focusable and showing who reacted, without toggling or the + button, which shows otherwise unless add is false', () => {
		const { chip, ontoggle, onreactors } = render({ disabled: true });
		expect(chip.disabled).toBe(false);
		expect(chip.getAttribute('aria-disabled')).toBe('true');
		chip.click();
		expect(ontoggle).not.toHaveBeenCalled();
		chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(onreactors).toHaveBeenCalledOnce();
		expect(dom.queryByRole('button', 'Add a reaction')).toBeNull();
		dom.unmount();
		// The + button shows otherwise, unless add is false.
		render();
		expect(dom.queryByRole('button', 'Add a reaction')).not.toBeNull();
		dom.unmount();
		render({ add: false });
		expect(dom.queryByRole('button', 'Add a reaction')).toBeNull();
	});
});
