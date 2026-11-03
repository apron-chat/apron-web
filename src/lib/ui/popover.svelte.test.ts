// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AnchoredPopover } from './popover.svelte';

const card = new AnchoredPopover<{ anchor: HTMLElement; userId: string }>();
const picker = new AnchoredPopover<{ anchor: HTMLElement }>();

function button(): HTMLButtonElement {
	return document.body.appendChild(document.createElement('button'));
}

afterEach(() => {
	card.close();
	picker.close();
	document.body.replaceChildren();
});

describe('AnchoredPopover', () => {
	it('toggles for one trigger, moves to another, and puts focus back on Escape', () => {
		const ada = button();
		const bob = button();
		card.toggle({ anchor: ada, userId: 'ada' });
		expect(card.isOpenFor(ada)).toBe(true);
		card.toggle({ anchor: bob, userId: 'bob' });
		expect(card.current?.userId).toBe('bob');
		card.toggle({ anchor: bob, userId: 'bob' });
		expect(card.current).toBeUndefined();
		card.open({ anchor: ada, userId: 'ada' });
		card.close(true);
		expect(document.activeElement).toBe(ada);
	});

	it('is open one at a time across the page', () => {
		card.open({ anchor: button(), userId: 'ada' });
		const react = button();
		picker.open({ anchor: react });
		expect(card.current).toBeUndefined();
		expect(picker.isOpenFor(react)).toBe(true);
	});

	it('closes for its owner going only when that owner opened it', () => {
		const mine = button();
		picker.open({ anchor: mine });
		picker.release(button());
		expect(picker.isOpenFor(mine)).toBe(true);
		picker.release(mine);
		expect(picker.current).toBeUndefined();
	});
});
