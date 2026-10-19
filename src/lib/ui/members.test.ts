import { describe, expect, it } from 'vitest';
import { userIdToAdd } from './members';

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
