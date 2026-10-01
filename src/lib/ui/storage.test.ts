import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppearance, loadNotificationScope, loadNotificationsEnabled, loadWebPushServer, loadWebPushServers, saveAppearance, saveNotificationScope, saveNotificationsEnabled, saveWebPushEnabled, saveWebPushServer } from './storage';

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

	it('keeps push on per server, and which server the subscription is for', () => {
		expect(loadWebPushServers()).toEqual([]);
		let servers = saveWebPushEnabled([], 'wss://a.example/', true);
		servers = saveWebPushEnabled(servers, 'wss://b.example/', true);
		servers = saveWebPushEnabled(servers, 'wss://a.example/', true);
		expect(servers).toEqual(['wss://b.example/', 'wss://a.example/']);
		expect(saveWebPushEnabled(servers, 'wss://b.example/', false)).toEqual(['wss://a.example/']);
		expect(loadWebPushServers()).toEqual(['wss://a.example/']);
		values.set('apron.webPush', '{broken');
		expect(loadWebPushServers()).toEqual([]);
		saveWebPushServer('wss://a.example/');
		expect(loadWebPushServer()).toBe('wss://a.example/');
		saveWebPushServer(undefined);
		expect(loadWebPushServer()).toBeUndefined();
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
