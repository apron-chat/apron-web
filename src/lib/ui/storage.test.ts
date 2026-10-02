import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppearance, loadNotificationScope, loadNotificationsEnabled, loadWebPushAccounts, loadWebPushOwner, loadWebPushWake, saveAppearance, saveNotificationScope, saveNotificationsEnabled, saveWebPushEnabled, saveWebPushOwner, saveWebPushWake } from './storage';

const values = new Map<string, string>();

beforeEach(() => {
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
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

	it('keeps push on per account, and which account the subscription is for, dropping per-server opt-ins', () => {
		values.set('apron.webPush', JSON.stringify(['wss://a.example/']));
		values.set('apron.webPushServer', 'wss://a.example/');
		expect(loadWebPushAccounts()).toEqual([]);
		expect([values.has('apron.webPush'), values.has('apron.webPushServer')]).toEqual([false, false]);
		const ada = 'wss://a.example/\nada';
		const bob = 'wss://a.example/\nbob';
		let accounts = saveWebPushEnabled([], ada, true);
		accounts = saveWebPushEnabled(accounts, bob, true);
		accounts = saveWebPushEnabled(accounts, ada, true);
		expect(accounts).toEqual([bob, ada]);
		expect(saveWebPushEnabled(accounts, bob, false)).toEqual([ada]);
		expect(loadWebPushAccounts()).toEqual([ada]);
		values.set('apron.webPushAccounts', '{broken');
		expect(loadWebPushAccounts()).toEqual([]);
		saveWebPushOwner(ada);
		expect(loadWebPushOwner()).toBe(ada);
		saveWebPushOwner(undefined);
		expect(loadWebPushOwner()).toBeUndefined();
	});

	it('keeps the wake scopes per account, none until chosen', () => {
		const ada = 'wss://a.example/\nada';
		const bob = 'wss://a.example/\nbob';
		expect(loadWebPushWake(ada)).toBeUndefined();
		saveWebPushWake(ada, ['mentions', 'private']);
		saveWebPushWake(bob, ['joined']);
		expect(loadWebPushWake(ada)).toEqual(['mentions', 'private']);
		expect(loadWebPushWake(bob)).toEqual(['joined']);
		expect(loadWebPushWake('wss://b.example/\nada')).toBeUndefined();
		values.set('apron.webPushWake', '{broken');
		expect(loadWebPushWake(ada)).toBeUndefined();
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
