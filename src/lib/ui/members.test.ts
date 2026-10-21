import { describe, expect, it } from 'vitest';
import { memberSections, userIdToAdd } from './members';

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
	type Person = { id: string; status?: string };
	const sections = (people: Person[], presence = true) => memberSections(people, (person) => person.status, presence).map(({ label, people }) => [label, people.map((person) => person.id)]);

	it('puts offline and invisible members under Offline, everyone else under Online, keeping the order they came in', () => {
		expect(sections([
			{ id: 'a', status: 'offline' },
			{ id: 'b', status: 'idle' },
			{ id: 'c', status: 'invisible' },
			{ id: 'd' },
			{ id: 'e', status: 'dnd' },
			{ id: 'f', status: 'brb' }
		])).toEqual([['Online', ['b', 'd', 'e', 'f']], ['Offline', ['a', 'c']]]);
	});

	it('leaves out an empty section', () => {
		expect(sections([{ id: 'a', status: 'offline' }])).toEqual([['Offline', ['a']]]);
		expect(sections([{ id: 'a', status: 'online' }])).toEqual([['Online', ['a']]]);
		expect(sections([])).toEqual([]);
	});

	it('has one Members section without presence, or where nobody has a status, even for a status kept from before', () => {
		expect(sections([{ id: 'a', status: 'offline' }, { id: 'b', status: 'online' }], false)).toEqual([['Members', ['a', 'b']]]);
		expect(sections([{ id: 'a' }, { id: 'b', status: '' }])).toEqual([['Members', ['a', 'b']]]);
	});
});
