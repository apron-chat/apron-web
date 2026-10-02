import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppearance, loadNotificationsEnabled, loadNotifyScopes, loadWebPushAccounts, loadWebPushOwner, saveAppearance, saveNotificationsEnabled, saveNotifyScopes, saveWebPushEnabled, saveWebPushOwner } from './storage';
import { notifyAccount } from './notify-scopes';

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
	it('keeps notifications off until chosen', () => {
		expect(loadNotificationsEnabled()).toBe(false);
		saveNotificationsEnabled(true);
		expect(loadNotificationsEnabled()).toBe(true);
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

	it('keeps what to notify about per account, and one choice for a server\'s guests', () => {
		const ada = notifyAccount('wss://a.example/', 'ada');
		const bob = notifyAccount('wss://a.example/', 'bob');
		const guests = notifyAccount('wss://a.example/', undefined);
		expect(guests).toBe('wss://a.example/\n~guest');
		expect(loadNotifyScopes(ada)).toBeUndefined();
		saveNotifyScopes(ada, ['mentions', 'private']);
		saveNotifyScopes(bob, ['joined']);
		saveNotifyScopes(guests, ['joined', 'mentions']);
		expect(loadNotifyScopes(ada)).toEqual(['mentions', 'private']);
		expect(loadNotifyScopes(bob)).toEqual(['joined']);
		expect(loadNotifyScopes(guests)).toEqual(['joined', 'mentions']);
		expect(loadNotifyScopes(notifyAccount('wss://b.example/', 'ada'))).toBeUndefined();
		values.set('apron.notifyScopes', '{broken');
		expect(loadNotifyScopes(ada)).toBeUndefined();
	});

	it('carries over push\'s wake scopes and the device-wide "Everything", then drops the old keys', () => {
		const ada = notifyAccount('wss://a.example/', 'ada');
		values.set('apron.webPushWake', JSON.stringify({ [ada]: ['private'] }));
		values.set('apron.notificationScope', 'everything');
		expect(loadNotifyScopes(ada)).toEqual(['private']);
		// Accounts without a choice take what "Everything" meant: every scope.
		expect(loadNotifyScopes(notifyAccount('wss://b.example/', 'bob'))).toEqual(['mentions', 'replies', 'private', 'joined']);
		expect([values.has('apron.webPushWake'), values.has('apron.notificationScope')]).toEqual([false, false]);
		// A choice made since wins over it.
		saveNotifyScopes(notifyAccount('wss://b.example/', 'bob'), ['mentions']);
		expect(loadNotifyScopes(notifyAccount('wss://b.example/', 'bob'))).toEqual(['mentions']);
	});

	it('takes the old "Mentions" setting as the default, mentions and replies', () => {
		values.set('apron.notificationScope', 'mentions');
		expect(loadNotifyScopes(notifyAccount('wss://a.example/', 'ada'))).toBeUndefined();
		expect(values.has('apron.notificationScope')).toBe(false);
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
