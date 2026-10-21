import { describe, expect, it } from 'vitest';
import { compareRoles, memberSections, userIdToAdd } from './members';

describe('adding a member', () => {
	it('takes exactly the user_id typed, with or without @', () => {
		expect(userIdToAdd(' @bob ')).toBe('bob');
		expect(userIdToAdd('guest_1234')).toBe('guest_1234');
		expect(userIdToAdd('@@bob')).toBe('@bob');
		expect(userIdToAdd('@ada+chat@example.com')).toBe('ada+chat@example.com');
	});

	it('never reads a display name, which isn’t unique', () => {
		expect(userIdToAdd('Bob Smith')).toBeUndefined();
		expect(userIdToAdd('  ')).toBeUndefined();
		expect(userIdToAdd('@')).toBeUndefined();
		// Nor anything with a control character, which no ID has (§2.4).
		expect(userIdToAdd('bob\u0007')).toBeUndefined();
	});
});

describe('member sections', () => {
	type Person = { id: string; status?: string; roles?: string[] };
	const sections = (people: Person[]) => memberSections(people, (person) => person.status, (person) => person.roles ?? []).map(({ label, people }) => [label, people.map((person) => person.id)]);

	it('orders roles by convention, admin and mod first and bot last, others by name between', () => {
		expect(['bot', 'zeta', 'Alpha', 'moderator', 'mod', 'admin'].sort(compareRoles)).toEqual(['admin', 'mod', 'moderator', 'Alpha', 'zeta', 'bot']);
	});

	it('puts each online member under their first role in that order, keeping the order they came in', () => {
		expect(sections([
			{ id: 'a', status: 'online', roles: ['helper', 'admin'] },
			{ id: 'b', status: 'idle', roles: ['helper'] },
			{ id: 'c', status: 'online' },
			{ id: 'd', status: 'brb', roles: ['bot'] },
			{ id: 'e', status: 'online', roles: ['helper'] }
		])).toEqual([['admin', ['a']], ['helper', ['b', 'e']], ['bot', ['d']], ['Online', ['c']]]);
	});

	it('lumps offline and invisible members into Offline, roles or not; no status stays online', () => {
		expect(sections([
			{ id: 'a', status: 'offline', roles: ['admin'] },
			{ id: 'b' },
			{ id: 'c', status: 'invisible' },
			{ id: 'd', status: '' }
		])).toEqual([['Online', ['b', 'd']], ['Offline', ['a', 'c']]]);
	});

	it('calls the rest Members where nobody has a status, and leaves out empty sections', () => {
		expect(sections([{ id: 'a' }, { id: 'b', roles: ['admin'] }])).toEqual([['admin', ['b']], ['Members', ['a']]]);
		expect(sections([])).toEqual([]);
	});
});
