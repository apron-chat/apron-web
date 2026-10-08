import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushIdFor, loadAppearance, loadNotificationsEnabled, loadNotifyScopes, loadWebPushAccounts, notificationsChosen, loadWebPushOwner, saveAppearance, saveNotificationsEnabled, saveNotifyScopes, saveWebPushEnabled, saveWebPushOwner } from './storage';
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
		expect(notificationsChosen()).toBe(false);
		saveNotificationsEnabled(true);
		expect(notificationsChosen()).toBe(true);
		expect(loadNotificationsEnabled()).toBe(true);
		saveNotificationsEnabled(false);
		expect(loadNotificationsEnabled()).toBe(false);
	});

	it('keeps push on per account, and which account the subscription is for', () => {
		expect(loadWebPushAccounts()).toEqual([]);
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
		saveWebPushOwner({ account: ada, key: 'BNcR' });
		expect(loadWebPushOwner()).toEqual({ account: ada, key: 'BNcR' });
		values.set('apron.webPushOwner', 'wss://a.example/\nada');
		expect(loadWebPushOwner()).toBeUndefined();
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

	it('carries over the device-wide "Everything", then drops the old key', () => {
		values.set('apron.notificationScope', 'everything');
		// Accounts without a choice take what "Everything" meant: every scope.
		expect(loadNotifyScopes(notifyAccount('wss://b.example/', 'bob'))).toEqual(['mentions', 'replies', 'private', 'joined']);
		expect(values.has('apron.notificationScope')).toBe(false);
		// A choice made since wins over it.
		saveNotifyScopes(notifyAccount('wss://b.example/', 'bob'), ['mentions']);
		expect(loadNotifyScopes(notifyAccount('wss://b.example/', 'bob'))).toEqual(['mentions']);
	});

	it('takes the old "Mentions" setting as the default, mentions and replies', () => {
		values.set('apron.notificationScope', 'mentions');
		expect(loadNotifyScopes(notifyAccount('wss://a.example/', 'ada'))).toBeUndefined();
		expect(values.has('apron.notificationScope')).toBe(false);
	});

	it('makes each account a random push_id once, and keeps it', () => {
		let made = 0;
		const make = () => `random${++made}`;
		const ada = notifyAccount('wss://a.example/', 'ada');
		expect(pushIdFor(ada, make)).toBe('random1');
		expect(pushIdFor(ada, make)).toBe('random1');
		expect(pushIdFor(notifyAccount('wss://a.example/', 'bob'), make)).toBe('random2');
		expect(JSON.parse(values.get('apron.pushIds')!)).toEqual({ [ada]: 'random1', 'wss://a.example/\nbob': 'random2' });
		// Made with the browser's randomness by default: 16 base64url characters.
		expect(pushIdFor(notifyAccount('wss://c.example/', 'cy'))).toMatch(/^[A-Za-z0-9_-]{16}$/);
	});

	it('round-trips appearance, and reads nothing from a missing or broken entry', () => {
		expect(loadAppearance()).toBeNull();
		const preferences = { mode: 'dark', theme: 'custom', customCss: '--font-sans: Inter;', vars: [['--font-sans', 'Inter']] } satisfies Parameters<typeof saveAppearance>[0];
		saveAppearance(preferences);
		expect(loadAppearance()).toEqual(preferences);
		values.set('apron.appearance', '{broken');
		expect(loadAppearance()).toBeUndefined();
	});
});
