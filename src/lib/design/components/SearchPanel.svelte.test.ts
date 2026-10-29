// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import SearchPanel from './SearchPanel.svelte';
import type { SearchResult } from './types';
import * as dom from '$lib/test/dom';
import { byLabel, queryByText } from '$lib/test/queries';

beforeAll(dom.stubDialog);

const result = (id: string, text: string): SearchResult => ({ id, room: 'general', who: 'Ada', when: 'Today 14:02', parts: [{ text: 'the ', match: false }, { text, match: true }] });

function render(props: Record<string, unknown> = {}) {
	const state = $state<Record<string, unknown>>({ open: true, query: '', results: [], onpick: vi.fn(), ...props });
	dom.render(SearchPanel, state as never);
	flushSync();
	return { state, field: byLabel('Search for') as HTMLInputElement, list: dom.queryByRole('listbox', 'Messages found')! };
}

describe('SearchPanel', () => {
	it('says what to do, that it is searching, and when nothing matched', () => {
		const { state } = render();
		expect(queryByText('Type to search.')).not.toBeNull();
		state.query = 'deploy';
		state.searching = true;
		flushSync();
		expect(queryByText('Searching…')).not.toBeNull();
		state.searching = false;
		flushSync();
		expect(queryByText('No messages match “deploy”.')).not.toBeNull();
	});

	it('marks the words found, and opens the result the keyboard is on with Enter', () => {
		const { state, field, list } = render({ query: 'deploy', results: [result('2', 'deploy'), result('1', 'deploys')] });
		expect([...list.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['deploy', 'deploys']);
		expect(field.getAttribute('aria-activedescendant')).toBe(list.querySelector('[role="option"]')!.id);
		dom.press(field, 'ArrowDown');
		dom.press(field, 'ArrowDown');
		dom.press(field, 'Enter');
		flushSync();
		expect(state.onpick).toHaveBeenCalledWith('1');
		expect(state.open).toBe(false);
	});

	it('says when only the newest are listed', () => {
		render({ query: 'the', results: [result('1', 'the')], more: true });
		expect(queryByText('Only the newest are listed. Add words to narrow it down.')).not.toBeNull();
	});

	it('is named Search local history, its “history” a link that closes it when there is somewhere to go', () => {
		const onhistory = vi.fn();
		const { state } = render({ onhistory });
		const title = document.querySelector('.ap-dialog-title')!;
		expect(document.querySelector('dialog')!.getAttribute('aria-labelledby')).toBe(title.id);
		expect(title.textContent!.replace(/\s+/g, ' ').trim()).toBe('Search local history');
		dom.button('history').click();
		flushSync();
		expect(onhistory).toHaveBeenCalledOnce();
		expect(state.open).toBe(false);
	});
});
