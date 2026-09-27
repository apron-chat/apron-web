import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNotificationScope, saveNotificationScope } from './notifications';

const values = new Map<string, string>();
const storage = {
	getItem: (key: string) => values.get(key) ?? null,
	setItem: (key: string, value: string) => values.set(key, value)
};

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

describe('notification scope preferences', () => {
	it('defaults to mentions and persists the selected scope locally', () => {
		vi.stubGlobal('localStorage', storage);
		expect(loadNotificationScope()).toBe('mentions');
		saveNotificationScope('everything');
		expect(loadNotificationScope()).toBe('everything');
	});
});
