// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReactorsPopover from './ReactorsPopover.svelte';
import * as dom from '$lib/test/dom';

// jsdom has no ResizeObserver, which the popover's `bind:offsetHeight` uses.
beforeEach(() => {
	dom.stubResizeObserver();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const rows = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>('li')];

describe('ReactorsPopover', () => {
	it('counts the reactions, and shows @user_id only where it is asked for, to tell people apart', () => {
		dom.render(ReactorsPopover, { emoji: '👍', reactors: [{ user_id: 'you', name: 'You', you: true }, { user_id: 'linus' }, { user_id: 'grace', name: 'grace', handle: true }] });
		const box = dom.byRole('dialog', '3 reactions with 👍');
		expect(rows(box).map((row) => [row.dataset.userId, row.querySelector('.ap-reactors-names')?.textContent?.trim()])).toEqual([
			['you', 'You(you)'], ['linus', 'linus'], ['grace', 'grace @grace']
		]);
	});

	it('keeps each person’s row, by user_id, as the list changes order', () => {
		const props = $state({ emoji: '👍', reactors: [{ user_id: 'ada' }, { user_id: 'bo' }] });
		dom.render(ReactorsPopover, props);
		const box = dom.byRole('dialog', '2 reactions with 👍');
		const ada = rows(box)[0];
		props.reactors = [{ user_id: 'bo' }, { user_id: 'ada' }];
		flushSync();
		expect(rows(box).map((row) => row.dataset.userId)).toEqual(['bo', 'ada']);
		expect(rows(box)[1]).toBe(ada);
	});
});
