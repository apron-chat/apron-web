import { describe, expect, it } from 'vitest';
import { CountedMap, KeptUsers } from './client-internals';

describe('KeptUsers', () => {
	it('counts a change to what is kept of a user, but not to their status or seen', () => {
		const users = new KeptUsers();
		users.set('ada', { user_id: 'ada', name: 'Ada', roles: ['admin'] });
		const added = users.revision;
		users.set('ada', { user_id: 'ada', name: 'Ada', roles: ['admin'], status: 'online', seen: '1' });
		users.set('ada', { user_id: 'ada', name: 'Ada', roles: ['admin'], status: 'offline' });
		expect(users.revision).toBe(added);
		users.set('ada', { user_id: 'ada', name: 'Ada L', roles: ['admin'] });
		expect(users.revision).toBe(added + 1);
		users.set('ada', { user_id: 'ada', name: 'Ada L' });
		expect(users.revision).toBe(added + 2);
		users.delete('ada');
		users.delete('ada');
		users.clear();
		expect(users.revision).toBe(added + 3);
	});
});

describe('CountedMap', () => {
	it('counts each change, and nothing that changes nothing', () => {
		const aliases = new CountedMap<string, string>();
		aliases.set('guest_1', 'ada');
		aliases.set('guest_1', 'ada');
		aliases.set('guest_1', 'bob');
		aliases.delete('nobody');
		aliases.clear();
		expect(aliases.revision).toBe(3);
	});
});
