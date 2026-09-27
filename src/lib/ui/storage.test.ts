import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppearance, loadNotificationScope, loadNotificationsEnabled, saveAppearance, saveNotificationScope, saveNotificationsEnabled } from './storage';

const values = new Map<string, string>();

beforeEach(() => {
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value)
	});
});

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

describe('preference storage', () => {
	it('keeps notifications off and scoped to mentions until chosen', () => {
		expect([loadNotificationsEnabled(), loadNotificationScope()]).toEqual([false, 'mentions']);
		saveNotificationsEnabled(true);
		saveNotificationScope('everything');
		expect([loadNotificationsEnabled(), loadNotificationScope()]).toEqual([true, 'everything']);
		saveNotificationsEnabled(false);
		expect(loadNotificationsEnabled()).toBe(false);
	});

	it('round-trips appearance, and reads nothing from a missing or broken entry', () => {
		expect(loadAppearance()).toBeNull();
		const preferences = { mode: 'dark', interfaceFont: 'Inter', chatFont: '', monoFont: '' } as const;
		saveAppearance(preferences);
		expect(loadAppearance()).toEqual(preferences);
		values.set('apron.appearance', '{broken');
		expect(loadAppearance()).toBeUndefined();
	});
});
