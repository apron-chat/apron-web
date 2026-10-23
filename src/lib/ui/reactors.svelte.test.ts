// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '$lib/protocol/client';
import type { Identity } from '$lib/protocol/types';
import { directory } from '$lib/ui/directory.svelte';
import { blankSnapshot } from '$lib/ui/session.svelte';
import { reactionChips, type ReactionChip } from '$lib/ui/reactions';
import ReactionBar from '$lib/design/components/ReactionBar.svelte';
import ReactorsPopover from '$lib/components/ReactorsPopover.svelte';
import { reactorsList, showReactors } from './reactors.svelte';
import * as dom from '$lib/test/dom';

const you: Identity = { user_id: 'you', name: 'You' };
const ada: Identity = { user_id: 'ada', name: 'Ada' };
const bob: Identity = { user_id: 'bob', name: 'Bob' };

// jsdom has no ResizeObserver, which `bind:offsetHeight` uses.
beforeEach(() => {
	dom.stubResizeObserver();
	const snapshot: ClientSnapshot = { ...blankSnapshot(), authenticated: true, you, users: { you, ada, bob }, recordedUsers: {}, userAliases: {} };
	directory.apply(snapshot, undefined);
});

afterEach(() => {
	reactorsList.close();
	directory.forget();
	vi.unstubAllGlobals();
});

function chipsOf(users: Identity[], emoji = '👍'): ReactionChip[] {
	const ids = users.map((user) => user.user_id).sort();
	return reactionChips([{ emoji, count: ids.length, user_ids: ids, users: ids.map((id) => users.find((user) => user.user_id === id)!), mine: ids.includes('you') }], 'you');
}

function render(chips: ReactionChip[], enabled = true) {
	const ontoggle = vi.fn();
	dom.render(ReactorsPopover);
	dom.render(ReactionBar, { reactions: chips, disabled: !enabled, add: false, ontoggle, onreactors: (emoji: string, anchor: HTMLElement) => showReactors(anchor, emoji, () => chips) });
	const chip = dom.button(/^👍 /) as HTMLButtonElement;
	return { chip, ontoggle };
}

const reactors = () => [...document.querySelectorAll('[data-testid="reactor"]')].map((row) => row.getAttribute('data-user-id'));

describe('who reacted', () => {
	it('lists who reacted on a right-click, you first, without toggling', () => {
		const { chip, ontoggle } = render(chipsOf([ada, bob, you]));
		const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
		chip.dispatchEvent(menu);
		flushSync();
		expect(menu.defaultPrevented).toBe(true);
		expect(reactors()).toEqual(['you', 'ada', 'bob']);
		expect(document.querySelector('[data-testid="reactors"]')?.getAttribute('aria-label')).toBe('3 reactions with 👍');
		expect(ontoggle).not.toHaveBeenCalled();
	});

	it('lists who reacted when you can not react, and Escape closes it', () => {
		const { chip, ontoggle } = render(chipsOf([bob]), false);
		chip.click();
		expect(ontoggle).not.toHaveBeenCalled();
		chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		flushSync();
		expect(reactors()).toEqual(['bob']);
		document.querySelector('[data-testid="reactors"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(document.querySelector('[data-testid="reactors"]')).toBeNull();
		expect(document.activeElement).toBe(chip);
	});
});
