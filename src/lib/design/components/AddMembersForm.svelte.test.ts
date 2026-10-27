// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import AddMembersForm from './AddMembersForm.svelte';
import type { PickPerson } from './types';
import * as dom from '$lib/test/dom';
import { byLabel, queryByText } from '$lib/test/queries';

beforeAll(dom.stubDialog);

const bob: PickPerson = { user_id: 'bob', name: 'Bob' };
const carol: PickPerson = { user_id: 'carol', name: 'Carol', existing: true };

/** The form, with its chips kept in state as the app keeps them: a pick toggles, a remove takes one out. */
function render(props: Record<string, unknown> = {}) {
	const state = $state<Record<string, unknown>>({ open: true, room: 'design', people: [bob, carol], chosen: [], query: '', onsubmit: vi.fn(), ...props });
	const ids = () => (state.chosen as PickPerson[]).map((person) => person.user_id);
	state.onpick = vi.fn((userId: string) => {
		state.chosen = ids().includes(userId) ? (state.chosen as PickPerson[]).filter((person) => person.user_id !== userId) : [...(state.chosen as PickPerson[]), (state.people as PickPerson[]).find((person) => person.user_id === userId)!];
	});
	state.onremove = vi.fn((userId: string) => (state.chosen = (state.chosen as PickPerson[]).filter((person) => person.user_id !== userId)));
	dom.render(AddMembersForm, state as never);
	flushSync();
	return { state, ids, field: byLabel('Add'), list: dom.queryByRole('listbox', 'People')! };
}

describe('AddMembersForm', () => {
	it('picks people as New private conversation does, named for the room, and adds them', async () => {
		const { state, ids, field, list } = render();
		expect(queryByText('Add people to design')).not.toBeNull();
		expect(field.getAttribute('aria-controls')).toBe(list.id);
		// Picking someone you already talk to adds them like anyone else: nothing here opens a conversation.
		expect(list.querySelector('.ap-pick-tag')).toBeNull();
		expect(dom.button('Add').disabled).toBe(true);
		dom.press(field, 'ArrowDown');
		dom.press(field, 'Enter');
		flushSync();
		expect(ids()).toEqual(['bob']);
		expect(dom.button('Add Bob').disabled).toBe(false);
		dom.type(field, 'car');
		state.people = [carol];
		flushSync();
		dom.press(field, 'Enter');
		flushSync();
		expect(ids()).toEqual(['bob', 'carol']);
		await dom.submit();
		expect(state.onsubmit).toHaveBeenCalledOnce();
		dom.press(field, 'Backspace');
		flushSync();
		expect(ids()).toEqual(['bob']);
	});

	it('says it is adding, and what went wrong', () => {
		render({ chosen: [bob, carol], status: 'saving', error: 'Couldn’t add Carol: Denied.' });
		expect(dom.button('Adding…').disabled).toBe(true);
		expect(dom.byRole('alert').textContent).toBe('Couldn’t add Carol: Denied.');
		dom.unmount();
		render({ people: [] });
		expect(queryByText('No one else to add yet')).not.toBeNull();
		dom.unmount();
		render({ chosen: [bob, carol] });
		expect(dom.button('Add 2 people')).toBeTruthy();
	});
});
