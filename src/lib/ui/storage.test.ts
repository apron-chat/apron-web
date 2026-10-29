import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pushIdFor, loadRecentServers, refreshRecentServer, rememberServer, hideDescription, loadAppearance, loadShutMemberSections, saveShutMemberSections, loadFoldedSections, saveFoldedSections, loadHiddenDescriptions, loadAddedRooms, saveAddedRooms, showDescription, descriptionHidden, loadNotificationsEnabled, loadNotifyScopes, loadWebPushAccounts, notificationsChosen, loadWebPushOwner, saveAppearance, saveNotificationsEnabled, saveNotifyScopes, saveWebPushEnabled, saveWebPushOwner } from './storage';
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

describe('recent servers', () => {
	it('keys each by its normalized address (§1), folding older entries for the same server into the newest', () => {
		values.set('apron.recentServers', JSON.stringify([
			{ url: 'wss://Chat.Example:443', label: 'chat.example' },
			{ url: 'wss://chat.example/', title: 'Old title' },
			{ url: 'ws://chat.example/', title: 'Plain' },
			{ url: 'not a url' },
			{ url: 7 },
			{ url: 'wss://other.example/%7eada', title: 'Other', avatar: 'https://other.example/a.png' }
		]));
		expect(loadRecentServers()).toEqual([
			{ url: 'wss://chat.example/' },
			{ url: 'ws://chat.example/', title: 'Plain' },
			{ url: 'wss://other.example/~ada', title: 'Other', avatar: 'https://other.example/a.png' }
		]);
	});

	it('folds an entry saved with a fragment into its address without one', () => {
		values.set('apron.recentServers', JSON.stringify([
			{ url: 'wss://chat.example/ws#team', title: 'Team' },
			{ url: 'wss://chat.example/ws', title: 'Older' }
		]));
		expect(loadRecentServers()).toEqual([{ url: 'wss://chat.example/ws', title: 'Team' }]);
		expect(rememberServer(loadRecentServers(), 'wss://chat.example/ws#other', { title: 'Team' })).toEqual([{ url: 'wss://chat.example/ws', title: 'Team' }]);
	});

	it('remembers how a server looked, never finding it by its title', () => {
		let recent = rememberServer([], 'wss://chat.example', { title: 'Chat', avatar: 'https://chat.example/icon.png' });
		recent = rememberServer(recent, 'wss://evil.example/', { title: 'Chat' });
		expect(recent.map((server) => server.url)).toEqual(['wss://evil.example/', 'wss://chat.example/']);
		// A new server frame updates its entry in place; a server not listed isn't added.
		recent = refreshRecentServer(recent, 'WSS://CHAT.EXAMPLE:443/', { title: 'Chat, renamed' });
		expect(recent[1]).toEqual({ url: 'wss://chat.example/', title: 'Chat, renamed' });
		expect(refreshRecentServer(recent, 'wss://new.example/', { title: 'New' })).toBe(recent);
		expect(JSON.parse(values.get('apron.recentServers')!)).toEqual(recent);
	});
});

describe('preference storage', () => {
	it('keeps the member list\'s and the sidebar\'s folded sections, open until folded, and ignores what isn\'t a list of keys', () => {
		expect(loadShutMemberSections()).toEqual([]);
		saveShutMemberSections(['offline']);
		expect(values.get('apron.memberSections')).toBe('["offline"]');
		expect(loadShutMemberSections()).toEqual(['offline']);
		// The sidebar's sections folded to what has news, the same way.
		expect(loadFoldedSections()).toEqual([]);
		saveFoldedSections(['rooms', 'more']);
		expect(loadFoldedSections()).toEqual(['rooms', 'more']);
		values.set('apron.sidebarFolds', '{');
		expect(loadFoldedSections()).toEqual([]);
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

	it('keeps the rooms someone added each account to, until there are none left', () => {
		const ada = notifyAccount('wss://a.example/', 'ada');
		const bob = notifyAccount('wss://a.example/', 'bob');
		expect(loadAddedRooms(ada)).toEqual([]);
		saveAddedRooms(ada, ['p1', 'p2']);
		saveAddedRooms(bob, ['p3']);
		expect([loadAddedRooms(ada), loadAddedRooms(bob)]).toEqual([['p1', 'p2'], ['p3']]);
		saveAddedRooms(ada, []);
		expect(loadAddedRooms(ada)).toEqual([]);
		expect(JSON.parse(values.get('apron.addedRooms')!)).toEqual({ [bob]: ['p3'] });
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

	it('keeps a description put away until it is edited, and forgets the oldest past the limit', () => {
		expect(loadHiddenDescriptions()).toEqual({});
		let hidden = hideDescription({}, 'general', 'Say hello.');
		expect(descriptionHidden(hidden, 'general', 'Say hello.')).toBe(true);
		expect(descriptionHidden(hidden, 'general', 'Say hello, and read the rules.')).toBe(false);
		expect(descriptionHidden(hidden, 'random', 'Say hello.')).toBe(false);
		expect(descriptionHidden(loadHiddenDescriptions(), 'general', 'Say hello.')).toBe(true);
		expect(descriptionHidden(showDescription(hidden, 'general'), 'general', 'Say hello.')).toBe(false);
		expect(descriptionHidden(loadHiddenDescriptions(), 'general', 'Say hello.')).toBe(false);
		for (let i = 0; i < 200; i++) hidden = hideDescription(hidden, `room${i}`, 'Description');
		expect(Object.keys(hidden)).toHaveLength(200);
		expect(descriptionHidden(loadHiddenDescriptions(), 'general', 'Say hello.')).toBe(false);
		expect(descriptionHidden(loadHiddenDescriptions(), 'room199', 'Description')).toBe(true);
		values.set('apron.hiddenSummaries', '{broken');
		expect(loadHiddenDescriptions()).toEqual({});
	});

	it('keeps the descriptions another tab put away, or brought back, since this one loaded them', () => {
		const here = loadHiddenDescriptions();
		hideDescription(loadHiddenDescriptions(), 'general', 'Say hello.');
		hideDescription(loadHiddenDescriptions(), 'design', 'Critiques.');
		const hidden = hideDescription(here, 'random', 'Anything goes.');
		expect(descriptionHidden(hidden, 'general', 'Say hello.')).toBe(true);
		expect(descriptionHidden(loadHiddenDescriptions(), 'general', 'Say hello.')).toBe(true);
		expect(descriptionHidden(loadHiddenDescriptions(), 'random', 'Anything goes.')).toBe(true);
		showDescription(loadHiddenDescriptions(), 'design');
		expect(descriptionHidden(showDescription(hidden, 'random'), 'design', 'Critiques.')).toBe(false);
		expect(Object.keys(loadHiddenDescriptions())).toEqual(['general']);
	});
});
