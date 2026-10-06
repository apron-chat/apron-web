import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushRegistration } from '$lib/protocol/client';
import { PushSettings, type PushSettingsClient } from './push-settings.svelte';
import { WebPushSync, type PushBrowser } from './web-push';

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

/** One browser's push subscription, shared by its tabs. */
function fakeBrowser() {
	const state = { subscribed: false, unsubscribes: 0 };
	const browser: PushBrowser = {
		subscribe: async () => {
			state.subscribed = true;
			return { endpoint: 'https://push.example/1', keys: { p256dh: 'BPk', auth: 'c2Vj' } };
		},
		unsubscribe: async () => {
			if (state.subscribed) state.unsubscribes += 1;
			state.subscribed = false;
		},
		endpoint: async () => (state.subscribed ? 'https://push.example/1' : undefined)
	};
	return { browser, state };
}

function fakeClient(url = 'wss://a.example/'): PushSettingsClient & { registrations: Array<PushRegistration | undefined>; off: Array<string | undefined> } {
	const client = {
		url,
		registrations: [] as Array<PushRegistration | undefined>,
		off: [] as Array<string | undefined>,
		setPushRegistration: (registration: PushRegistration | undefined) => { client.registrations.push(registration); },
		setPushOff: (offUrl: string | undefined) => { client.off.push(offUrl); }
	};
	return client;
}

/** A tab: its settings, over the browser's shared subscription and storage. */
function tab(browser: PushBrowser, badge = vi.fn(), ids = vi.fn(async () => undefined)) {
	const settings = new PushSettings({ sync: new WebPushSync(browser, (account) => `id-${account.split('\n')[1]}`), setBadge: badge, saveEnabledIds: ids, pushIdOf: (account) => `id-${account.split('\n')[1]}` });
	settings.load();
	return { settings, badge, ids };
}

const ada = 'wss://a.example/\nada';

describe('push settings', () => {
	it('turns push on for an account, subscribing and registering with its push_id, and mirrors the enabled ids', async () => {
		const { browser, state } = fakeBrowser();
		const { settings, ids } = tab(browser);
		const client = fakeClient();
		await settings.turnOn(client, 'ada', 'K1', ['mentions'], true);
		expect(settings.accounts).toEqual([ada]);
		expect(state.subscribed).toBe(true);
		expect(client.registrations.at(-1)).toMatchObject({ kind: 'webpush', push_id: 'id-ada', wake: ['mentions'] });
		expect(settings.owner).toEqual({ account: ada, key: 'K1' });
		expect(ids).toHaveBeenLastCalledWith(['id-ada']);
	});

	it('turns push off for an account signing out while offline, and drops the subscription when none is left', async () => {
		const { browser, state } = fakeBrowser();
		const { settings, badge, ids } = tab(browser);
		const client = fakeClient();
		await settings.turnOn(client, 'ada', 'K1', undefined, true);
		// Offline: the client can't tell the server, but push still goes off here.
		await settings.signedOut(client, ada);
		expect(settings.accounts).toEqual([]);
		expect(settings.owner).toBeUndefined();
		expect(state.subscribed).toBe(false);
		expect(client.registrations.at(-1)).toBeUndefined();
		expect(ids).toHaveBeenLastCalledWith([]);
		expect(badge).toHaveBeenCalledWith(0);
		// Signing out of an account push was off for changes nothing.
		await settings.signedOut(client, 'wss://a.example/\nbob');
		expect(state.unsubscribes).toBe(1);
	});

	it('keeps the subscription for the other account when one turns push off', async () => {
		const { browser, state } = fakeBrowser();
		const { settings } = tab(browser);
		await settings.turnOn(fakeClient(), 'ada', 'K1', undefined, true);
		await settings.turnOn(fakeClient(), 'bob', 'K1', undefined, true);
		await settings.turnOff(fakeClient(), ada);
		expect(settings.accounts).toEqual(['wss://a.example/\nbob']);
		expect(state.subscribed).toBe(true);
	});

	it('unregisters the browser\'s endpoint after each auth while push is off for the account signed in', async () => {
		const { browser } = fakeBrowser();
		const { settings } = tab(browser);
		await settings.turnOn(fakeClient(), 'bob', 'K1', undefined, true);
		const client = fakeClient();
		await settings.keepOff(client);
		expect(client.registrations).toEqual([undefined]);
		expect(client.off).toEqual(['https://push.example/1']);
	});

	it('shows why subscribing failed', async () => {
		const { browser } = fakeBrowser();
		browser.subscribe = async () => { throw new Error('denied'); };
		const { settings } = tab(browser);
		await settings.turnOn(fakeClient(), 'ada', 'K1', undefined, true);
		expect(settings.error).toMatch(/couldn’t subscribe/);
	});

	it('is followed by another tab, which sees push on, the subscription held by another server, and it freed again', async () => {
		const { browser, state } = fakeBrowser();
		const first = tab(browser);
		const second = tab(browser);
		await first.settings.turnOn(fakeClient(), 'ada', 'K1', undefined, true);
		second.settings.storageChanged('apron.webPushAccounts');
		second.settings.storageChanged('apron.webPushOwner');
		expect(second.settings.isOn(ada)).toBe(true);
		// The second tab is on another server, with another key, with push on too: held by the first's.
		const carl = 'wss://c.example/\ncarl';
		await second.settings.turnOn(fakeClient('wss://c.example/'), 'carl', undefined, undefined, false);
		first.settings.storageChanged('apron.webPushAccounts');
		expect(second.settings.heldBy(carl, 'K2')).toBe('wss://a.example/');
		// Turning it off in the first tab frees it, and the second tab sees that.
		await first.settings.turnOff(fakeClient(), ada);
		second.settings.storageChanged('apron.webPushAccounts');
		second.settings.storageChanged('apron.webPushOwner');
		expect(second.settings.heldBy(carl, 'K2')).toBeUndefined();
		// Carl still has push on, so the subscription stays for it to take.
		expect(state.subscribed).toBe(true);
	});

	it('drops the subscription on load when no account here has push on', async () => {
		const { browser, state } = fakeBrowser();
		state.subscribed = true;
		values.set('apron.webPushOwner', JSON.stringify({ account: ada, key: 'K1' }));
		const { settings } = tab(browser);
		await vi.waitFor(() => expect(state.subscribed).toBe(false));
		expect(settings.owner).toBeUndefined();
		expect(values.has('apron.webPushOwner')).toBe(false);
	});

	it('runs subscription steps under the apron-push lock where the browser has one', async () => {
		const request = vi.fn(async (_name: string, step: () => Promise<unknown>) => step());
		vi.stubGlobal('navigator', { locks: { request } });
		const { browser } = fakeBrowser();
		const { settings } = tab(browser);
		await settings.turnOn(fakeClient(), 'ada', 'K1', undefined, true);
		expect(request.mock.calls.map((call) => call[0])).toContain('apron-push');
	});
});

describe('the account\'s push_id', () => {
	it('is made and kept by follow, from an effect, so a derivation only reads it', () => {
		const made = vi.fn((account: string) => `id-${account}`);
		const settings = new PushSettings({ pushIdOf: made, saveEnabledIds: async () => undefined });
		let derived: string | undefined;
		const stop = $effect.root(() => {
			const read = $derived(settings.accountPushId);
			$effect(() => {
				derived = read;
			});
		});
		flushSync();
		expect(derived).toBeUndefined();
		expect(made).not.toHaveBeenCalled();
		settings.follow('wss://a/\nada');
		flushSync();
		expect(made).toHaveBeenCalledTimes(1);
		expect(derived).toBe('id-wss://a/\nada');
		settings.follow(undefined);
		flushSync();
		expect(derived).toBeUndefined();
		expect(made).toHaveBeenCalledTimes(1);
		stop();
	});
});
