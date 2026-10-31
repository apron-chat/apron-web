import { describe, expect, it } from 'vitest';
import { roomRoles, searchRoles } from './role-mentions';

const people = [
	{ id: 'ada', name: 'Ada', roles: ['mod', 'admin'] },
	{ id: 'bob', name: 'Bob', roles: ['mod'] },
	{ id: 'cy', name: 'Cy', roles: ['night shift', 'mod', 'mod'] },
	{ id: 'me', name: 'Me', roles: ['mod', 'owner'], me: true }
];

describe('roomRoles', () => {
	it('lists the roles others hold with who holds them, most held first, leaving out the viewer and roles that are not one ID', () => {
		expect(roomRoles(people)).toEqual([
			{ role: 'mod', members: ['ada', 'bob', 'cy'] },
			{ role: 'admin', members: ['ada'] }
		]);
	});
});

describe('searchRoles', () => {
	it('matches by prefix, an exact one first, and takes a leading &', () => {
		const roles = [{ role: 'moderator', members: ['a'] }, { role: 'mod', members: ['b'] }, { role: 'admin', members: ['c'] }];
		expect(searchRoles(roles, 'mod').map((role) => role.role)).toEqual(['mod', 'moderator']);
		expect(searchRoles(roles, '&ad').map((role) => role.role)).toEqual(['admin']);
		expect(searchRoles(roles, '').length).toBe(3);
		expect(searchRoles(roles, 'x')).toEqual([]);
	});
});
