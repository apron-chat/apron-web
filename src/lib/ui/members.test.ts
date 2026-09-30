import { describe, expect, it } from 'vitest';
import { userIdToAdd } from './members';

describe('adding a member', () => {
	it('takes exactly the user_id typed, with or without @', () => {
		expect(userIdToAdd(' @bob ')).toBe('bob');
		expect(userIdToAdd('guest_1234')).toBe('guest_1234');
		expect(userIdToAdd('@@bob')).toBe('@bob');
	});

	it('never reads a display name, which isn’t unique', () => {
		expect(userIdToAdd('Bob Smith')).toBeUndefined();
		expect(userIdToAdd('  ')).toBeUndefined();
		expect(userIdToAdd('@')).toBeUndefined();
	});
});
