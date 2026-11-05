// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import SearchPanel from './SearchPanel.svelte';
import type { RoomResult, SearchResult } from './types';
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

	it('says as results change what they came to, for a screen reader', () => {
		const { state } = render();
		const status = () => document.querySelector('[role="status"]')!.textContent;
		expect(status()).toBe('');
		state.query = 'deploy';
		state.searching = true;
		flushSync();
		expect(status()).toBe('Searching…');
		state.searching = false;
		state.results = [result('2', 'deploy'), result('1', 'deploys')];
		flushSync();
		expect(status()).toBe('2 messages found.');
		state.results = [result('1', 'deploys')];
		state.more = true;
		flushSync();
		expect(status()).toBe('1 message found, the newest.');
		state.results = [];
		state.more = false;
		flushSync();
		expect(status()).toBe('No messages match “deploy”.');
	});

	it('marks what was found, and opens the result the keyboard is on with Enter', () => {
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

	it('is named Search Local History, beside it how far back history is kept: a button that closes it for where that\'s set', () => {
		const onhistory = vi.fn();
		const { state } = render({ kept: '30 Days', onhistory });
		const title = document.querySelector('.ap-dialog-title')!;
		expect(document.querySelector('dialog')!.getAttribute('aria-labelledby')).toBe(title.id);
		expect(title.textContent!.replace(/\s+/g, ' ').trim()).toBe('Search Local History');
		dom.button('30 Days of history kept, in Preferences').click();
		flushSync();
		expect(onhistory).toHaveBeenCalledOnce();
		expect(state.open).toBe(false);
		// With nowhere to go, no button.
		dom.unmount();
		render({ kept: '30 Days' });
		expect(document.querySelector('.ap-dialog-titlebtn')).toBeNull();
	});

	it('finds rooms: each with its kind, its title marked, where it is, and Not joined or what is new, under headings', () => {
		const rooms: RoomResult[] = [
			{ kind: 'room', id: 't1', group: 'Joined', joined: true, thread: true, parts: [{ text: 'Dep', match: true }, { text: 'loy checklist', match: false }], detail: 'in Engineering · Today', unread: 2 },
			{ kind: 'room', id: 'r1', group: 'Not joined', joined: false, private: true, parts: [{ text: 'Dep', match: true }, { text: 'artures', match: false }] }
		];
		const state = $state<Record<string, unknown>>({ open: true, kind: 'rooms', title: 'Go to a Room or Thread', query: 'dep', results: rooms, onpick: vi.fn() });
		dom.render(SearchPanel, state as never);
		flushSync();
		const list = dom.queryByRole('listbox', 'Rooms and threads found')!;
		expect([...list.querySelectorAll('.ap-search-group')].map((group) => group.textContent)).toEqual(['Joined', 'Not joined']);
		const [thread, room] = [...list.querySelectorAll('[role="option"]')];
		expect(thread.querySelector('[aria-label="Thread"]')).not.toBeNull();
		expect(thread.querySelector('mark')!.textContent).toBe('Dep');
		expect(thread.querySelector('.ap-search-detail')!.textContent).toBe('in Engineering · Today');
		expect(thread.querySelector('.ap-count')!.getAttribute('aria-label')).toBe('2 unread replies');
		expect(room.querySelector('[aria-label="Room"]')).not.toBeNull();
		expect(room.querySelector('[aria-label="Private"]')).not.toBeNull();
		expect(room.querySelector('.ap-search-tag')!.textContent).toBe('Not joined');
		expect(document.querySelector('[role="status"]')!.textContent).toBe('2 rooms found.');
		state.results = [];
		flushSync();
		expect(queryByText('No rooms or threads match “dep”.')).not.toBeNull();
	});

	it('switches between its modes, and after its results offers an action, which keeps the keyboard in the field', () => {
		const onclick = vi.fn();
		const { state, field } = render({ modes: [{ id: 'rooms', label: 'Rooms and threads', keys: 'Ctrl K' }, { id: 'messages', label: 'Messages', keys: 'Ctrl F' }], mode: 'messages', action: { label: 'Load More from Server', note: 'Older messages are on the server.', onclick } });
		const radio = (name: RegExp) => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((button) => name.test(button.textContent ?? ''))!;
		expect(radio(/Messages/).getAttribute('aria-checked')).toBe('true');
		expect(radio(/Rooms/).querySelector('kbd')!.textContent).toBe('Ctrl K');
		radio(/Rooms/).click();
		flushSync();
		expect(state.mode).toBe('rooms');
		expect(document.activeElement).toBe(field);
		expect(queryByText('Older messages are on the server.')).not.toBeNull();
		dom.button('Load More from Server').click();
		flushSync();
		expect(onclick).toHaveBeenCalledOnce();
		expect(document.activeElement).toBe(field);
		state.action = { label: 'Load More from Server', busy: true, onclick };
		flushSync();
		expect(dom.button('Loading…').disabled).toBe(true);
		state.action = { label: 'Load More from Server', note: 'Everything is loaded.', done: true, onclick };
		flushSync();
		expect(document.querySelector('.ap-search-action button')).toBeNull();
		expect(queryByText('Everything is loaded.')).not.toBeNull();
	});

	it('hands the field\'s keys to `onfieldkey` first, with the result the keyboard is on', () => {
		const onfieldkey = vi.fn((event: KeyboardEvent) => event.key === 'ArrowRight');
		const { field } = render({ query: 'deploy', results: [result('2', 'deploy'), result('1', 'deploys')], onfieldkey });
		dom.press(field, 'ArrowDown');
		dom.press(field, 'ArrowRight');
		expect(onfieldkey).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'ArrowRight' }), '1');
	});
});
