import { describe, expect, it, vi } from 'vitest';
import { absentMentions, addMembers, couldNotAdd, isGuest, memberSections, roleSets, unheldRoleHolders, userIdToAdd } from './members';

describe('adding a member', () => {
	it('takes exactly the user_id typed, with or without @, and never a display name, which isn’t unique', () => {
		expect(userIdToAdd(' @bob ')).toBe('bob');
		expect(userIdToAdd('guest_1234')).toBe('guest_1234');
		expect(userIdToAdd('@@bob')).toBe('@bob');
		expect(userIdToAdd('@ada+chat@example.com')).toBe('ada+chat@example.com');
		expect(userIdToAdd('Bob Smith')).toBeUndefined();
		expect(userIdToAdd('  ')).toBeUndefined();
		expect(userIdToAdd('@')).toBeUndefined();
		// Nor anything with a control character, which no ID has (§2.4).
		expect(userIdToAdd('bob\u0007')).toBeUndefined();
	});

	it('adds each person in turn, past any the server refuses, and says who and why', async () => {
		const joinRoom = vi.fn((_room: string, userId: string) => ({ id: userId, promise: userId === 'carol' ? Promise.reject(new Error('In too many private rooms.')) : Promise.resolve({}) }));
		const refused = await addMembers({ joinRoom }, 'r1', ['bob', 'carol', 'dev']);
		expect(joinRoom.mock.calls).toEqual([['r1', 'bob'], ['r1', 'carol'], ['r1', 'dev']]);
		expect(refused).toEqual([{ userId: 'carol', message: 'In too many private rooms.' }]);
		expect(couldNotAdd([...refused, { userId: 'dev', message: 'Unknown user' }], (id) => id.toUpperCase()))
			.toBe('Couldn’t add CAROL: In too many private rooms. Couldn’t add DEV: Unknown user.');
	});
});

describe('who is offered to add', () => {
	it('leaves out guests: a guest_ user_id (§3.2) or the guest role', () => {
		expect(isGuest({ user_id: 'guest_1234' })).toBe(true);
		expect(isGuest({ user_id: 'ada', roles: ['guest'] })).toBe(true);
		expect(isGuest({ user_id: 'ada', roles: ['admin'] })).toBe(false);
		expect(isGuest({ user_id: 'guestbook' })).toBe(false);
		expect(isGuest({ user_id: 'preview_guest' })).toBe(false);
	});

	it('offers everyone with a role an @ names, the role named exactly first, then the most held', () => {
		const people = [
			{ user_id: 'ada', roles: ['mod', 'admin'] },
			{ user_id: 'bob', roles: ['moderator', 'mod', 'mod'] },
			{ user_id: 'cy', roles: ['moderator', 'night shift'] },
			{ user_id: 'dee', roles: ['moderator'] },
			{ user_id: 'eve' }
		];
		expect(roleSets(people, '@mod', 5)).toEqual([{ role: 'mod', userIds: ['ada', 'bob'] }, { role: 'moderator', userIds: ['bob', 'cy', 'dee'] }]);
		expect(roleSets(people, '@MO', 5)).toEqual([{ role: 'moderator', userIds: ['bob', 'cy', 'dee'] }, { role: 'mod', userIds: ['ada', 'bob'] }]);
		expect(roleSets(people, '@&admin', 5)).toEqual([{ role: 'admin', userIds: ['ada'] }]);
		expect(roleSets(people, ' &admin ', 5)).toEqual([{ role: 'admin', userIds: ['ada'] }]);
		expect(roleSets(people, '@mod', 1)).toEqual([{ role: 'mod', userIds: ['ada', 'bob'] }]);
		// A name without an @ names no role; nor does a bare @, and one with a space can't be written @&role.
		expect(roleSets(people, 'mod', 5)).toEqual([]);
		expect(roleSets(people, '@', 5)).toEqual([]);
		expect(roleSets(people, '@night', 5)).toEqual([]);
	});
});

describe('mentioning someone who isn’t in the room', () => {
	const room = { members: [{ user_id: 'me' }, { user_id: 'ada' }] };
	const skip = (userId: string) => userId === 'me' || userId.startsWith('guest_');


	it('asks about a role’s holders only when no one else here holds it', () => {
		const users = [{ user_id: 'me', roles: ['ops'] }, { user_id: 'ada', roles: ['admin'] }, { user_id: 'bob', roles: ['mod', 'admin'] }, { user_id: 'cy', roles: ['mod', 'ops'] }, { user_id: 'dee' }];
		const isMe = (userId: string) => userId === 'me';
		// Ada here holds admin, so it mentions her alone; no one here holds mod, so everyone with it is asked about.
		expect(unheldRoleHolders(['admin', 'mod'], users, new Set(['me', 'ada']), isMe)).toEqual(['bob', 'cy']);
		// Holding it yourself doesn't count: the mention leaves you out.
		expect(unheldRoleHolders(['ops'], users, new Set(['me', 'ada']), isMe)).toEqual(['me', 'cy']);
		expect(unheldRoleHolders([], users, new Set(), isMe)).toEqual([]);
	});

	it('names who isn’t a member, once each, as mentioned, but those skipped; no one while the members aren’t all known', () => {
		expect(absentMentions(['bob', 'ada', 'me', 'guest_9', 'carol', 'bob'], room, skip)).toEqual(['bob', 'carol']);
		expect(absentMentions(['ada'], room, skip)).toEqual([]);
		expect(absentMentions(['bob'], {}, skip)).toEqual([]);
		expect(absentMentions(['bob'], { ...room, memberCount: 40 }, skip)).toEqual([]);
		expect(absentMentions(['bob'], { ...room, memberCount: 2 }, skip)).toEqual(['bob']);
	});
});

describe('member sections', () => {
	type Person = { id: string; status?: string };
	const sections = (people: Person[], presence = true) => memberSections(people, (person) => person.status, presence).map(({ label, people }) => [label, people.map((person) => person.id)]);

	it('puts offline and invisible members under Offline, everyone else under Online, keeping the order they came in, and leaves out an empty section', () => {
		expect(sections([
			{ id: 'a', status: 'offline' },
			{ id: 'b', status: 'idle' },
			{ id: 'c', status: 'invisible' },
			{ id: 'd' },
			{ id: 'e', status: 'dnd' },
			{ id: 'f', status: 'brb' }
		])).toEqual([['Online', ['b', 'd', 'e', 'f']], ['Offline', ['a', 'c']]]);
		// An empty section is left out.
		expect(sections([{ id: 'a', status: 'offline' }])).toEqual([['Offline', ['a']]]);
		expect(sections([{ id: 'a', status: 'online' }])).toEqual([['Online', ['a']]]);
		expect(sections([])).toEqual([]);
	});

	it('has one Members section without presence, or where nobody has a status, even for a status kept from before', () => {
		expect(sections([{ id: 'a', status: 'offline' }, { id: 'b', status: 'online' }], false)).toEqual([['Members', ['a', 'b']]]);
		expect(sections([{ id: 'a' }, { id: 'b', status: '' }])).toEqual([['Members', ['a', 'b']]]);
	});
});
