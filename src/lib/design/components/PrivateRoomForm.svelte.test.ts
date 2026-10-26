// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import PrivateRoomForm from './PrivateRoomForm.svelte';
import type { PickPerson } from './types';
import * as dom from '$lib/test/dom';
import { byLabel, queryByText } from '$lib/test/queries';

beforeAll(dom.stubDialog);

const bob: PickPerson = { user_id: 'bob', name: 'Bob' };
const carol: PickPerson = { user_id: 'carol', name: 'Carol', existing: true };
const dev: PickPerson = { user_id: 'dev', name: 'Dev', detail: 'Can’t be added' };

/** The form, with its chips kept in state as the app keeps them: a pick toggles, a remove takes one out. */
function render(props: Record<string, unknown> = {}) {
	const state = $state<Record<string, unknown>>({ open: true, people: [bob, carol, dev], chosen: [], query: '', name: '', onopen: vi.fn(), onsubmit: vi.fn(), ...props });
	const ids = () => (state.chosen as PickPerson[]).map((person) => person.user_id);
	state.onpick = vi.fn((userId: string) => {
		state.chosen = ids().includes(userId) ? (state.chosen as PickPerson[]).filter((person) => person.user_id !== userId) : [...(state.chosen as PickPerson[]), (state.people as PickPerson[]).find((person) => person.user_id === userId)!];
	});
	state.onremove = vi.fn((userId: string) => (state.chosen = (state.chosen as PickPerson[]).filter((person) => person.user_id !== userId)));
	dom.render(PrivateRoomForm, state as never);
	flushSync();
	return { state, ids, field: byLabel('To'), list: dom.queryByRole('listbox', 'People')! };
}

const options = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>('[role="option"]')];

describe('PrivateRoomForm', () => {
	it('lists people as options of a listbox the field controls, with who you already talk to offered to open', () => {
		const { field, list } = render();
		expect(field.getAttribute('aria-controls')).toBe(list.id);
		expect(list.getAttribute('aria-multiselectable')).toBe('true');
		expect(field.getAttribute('role')).toBe('combobox');
		expect(options(list).map((option) => [
			option.querySelector('.ap-pick-who')?.textContent, option.querySelector('.ap-pick-tag')?.textContent, option.getAttribute('aria-selected')
		])).toEqual([['Bob@bob', undefined, 'false'], ['Carol@carol', 'Already talking · Open', 'false'], ['DevCan’t be added', undefined, 'false']]);
		// Nothing is submitted with no one picked.
		expect(dom.button('Start conversation').disabled).toBe(true);
	});

	it('moves through the people with the arrows, picks with Enter, and takes the last chip back with Backspace', () => {
		const { state, ids, field, list } = render();
		dom.press(field, 'ArrowDown');
		flushSync();
		expect(field.getAttribute('aria-activedescendant')).toBe(options(list)[0].id);
		expect(dom.press(field, 'Enter')).toBe(false);
		flushSync();
		expect(ids()).toEqual(['bob']);
		expect(options(list)[0].getAttribute('aria-selected')).toBe('true');
		expect(dom.button('Message Bob').disabled).toBe(false);
		// Carol, with someone picked already, joins the group rather than opening her conversation.
		dom.press(field, 'ArrowDown');
		dom.press(field, 'Enter');
		flushSync();
		expect(ids()).toEqual(['bob', 'carol']);
		expect(state.onopen).not.toHaveBeenCalled();
		// Two picked: a Name, and the button says what it starts.
		expect(byLabel('Name')).toBeTruthy();
		expect(dom.button('Start conversation').disabled).toBe(false);
		dom.press(field, 'Backspace');
		flushSync();
		expect(ids()).toEqual(['bob']);
		expect(queryByText('Name')).toBeNull();
		// A chip's × takes it out too.
		dom.button('Remove Bob').click();
		flushSync();
		expect(ids()).toEqual([]);
	});

	it('picks a person typed for at once, and opens the conversation you already have with one picked alone', () => {
		const { state, ids, field, list } = render();
		dom.type(field, 'car');
		// Typing puts the keyboard on the first match.
		expect(field.getAttribute('aria-activedescendant')).toBe(options(list)[0].id);
		state.people = [carol];
		flushSync();
		dom.press(field, 'Enter');
		flushSync();
		expect(state.onopen).toHaveBeenCalledWith('carol');
		expect(ids()).toEqual([]);
		expect(state.query).toBe('');
	});

	it('submits the people picked, and at the limit offers your private rooms to leave instead', async () => {
		const { state } = render({ chosen: [bob], quota: { used: 2, max: 5 } });
		expect(queryByText('2 of 5')).not.toBeNull();
		await dom.submit();
		expect(state.onsubmit).toHaveBeenCalledOnce();
		dom.unmount();
		const onleaveroom = vi.fn();
		render({ chosen: [bob], quota: { used: 5, max: 5 }, full: [{ id: 'p1', name: 'Dev', faces: [{ user_id: 'dev' }], detail: 'Quiet for a week' }], fullMore: 4, onleaveroom });
		expect(dom.byRole('alert').textContent).toMatch(/You’re in 5 private rooms, the most this server allows at once\.\s*Leave one to start another\./);
		expect(dom.queryByRole('listbox')).toBeNull();
		expect(dom.button('Message Bob').disabled).toBe(true);
		expect(queryByText('and 4 more')).not.toBeNull();
		dom.button('Leave Dev').click();
		expect(onleaveroom).toHaveBeenCalledWith('p1');
	});
});
