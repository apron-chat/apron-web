import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushIdFor, hideSummary, loadAppearance, loadShutMemberSections, saveShutMemberSections, loadHiddenSummaries, showSummary, summaryHidden, loadNotificationsEnabled, loadNotifyScopes, loadWebPushAccounts, notificationsChosen, loadWebPushOwner, saveAppearance, saveNotificationsEnabled, saveNotifyScopes, saveWebPushEnabled, saveWebPushOwner } from './storage';
import { notifyAccount } from './notify-scopes';
import { memoryStorage } from '$lib/test/storage';

const values = new Map<string, string>();

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage(values));
});

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

describe('preference storage', () => {
	it('keeps the member list\'s folded sections, open until folded, and ignores what isn\'t a list of keys', () => {
		expect(loadShutMemberSections()).toEqual([]);
		saveShutMemberSections(['offline']);
		expect(values.get('apron.memberSections')).toBe('["offline"]');
		expect(loadShutMemberSections()).toEqual(['offline']);
		values.set('apron.memberSections', '{"offline":true}');
		expect(loadShutMemberSections()).toEqual([]);
		values.set('apron.memberSections', 'not json');
		expect(loadShutMemberSections()).toEqual([]);
	});


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
		const preferences = { mode: 'dark', interfaceFont: 'Inter', chatFont: '', monoFont: '' } as const;
		saveAppearance(preferences);
		expect(loadAppearance()).toEqual(preferences);
		values.set('apron.appearance', '{broken');
		expect(loadAppearance()).toBeUndefined();
	});

	it('keeps a summary put away until it is edited, and forgets the oldest past the limit', () => {
		expect(loadHiddenSummaries()).toEqual({});
		let hidden = hideSummary({}, 'general', 'Say hello.');
		expect(summaryHidden(hidden, 'general', 'Say hello.')).toBe(true);
		expect(summaryHidden(hidden, 'general', 'Say hello, and read the rules.')).toBe(false);
		expect(summaryHidden(hidden, 'random', 'Say hello.')).toBe(false);
		expect(summaryHidden(loadHiddenSummaries(), 'general', 'Say hello.')).toBe(true);
		expect(summaryHidden(showSummary(hidden, 'general'), 'general', 'Say hello.')).toBe(false);
		expect(summaryHidden(loadHiddenSummaries(), 'general', 'Say hello.')).toBe(false);
		for (let i = 0; i < 200; i++) hidden = hideSummary(hidden, `room${i}`, 'Summary');
		expect(Object.keys(hidden)).toHaveLength(200);
		expect(summaryHidden(loadHiddenSummaries(), 'general', 'Say hello.')).toBe(false);
		expect(summaryHidden(loadHiddenSummaries(), 'room199', 'Summary')).toBe(true);
		values.set('apron.hiddenSummaries', '{broken');
		expect(loadHiddenSummaries()).toEqual({});
	});
});
