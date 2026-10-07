import { afterEach, describe, expect, it, vi } from 'vitest';
import { webPushKey } from '$lib/protocol/client';
import type { PushRegistration } from '$lib/protocol/client';
import { base64url } from '$lib/protocol/webauthn';
import { accountServer, base64UrlToBytes, canOfferInstall, isStandalone, keepsPushOff, needsHomeScreen, offeredWake, pushHeldBy, sameServerKey, webPushAccount, webPushRegistration, WebPushSync, type PushBrowser } from './web-push';

describe('web push', () => {
	it('decodes base64url keys, padded or not, and encodes them back unpadded', () => {
		expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff]);
		expect([...base64UrlToBytes('-_8=')]).toEqual([0xfb, 0xff]);
		expect([...base64UrlToBytes('')]).toEqual([]);
		const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
		const bytes = base64UrlToBytes(key);
		expect(bytes.length).toBe(65);
		expect(bytes[0]).toBe(0x04);
		expect(base64url(bytes)).toBe(key);
		expect(base64url(bytes.buffer)).toBe(key);
		expect(() => base64UrlToBytes('not+base64/url')).toThrow();
	});

	it('tells whether a subscription was made with the server\'s key', () => {
		const key = 'AQIDBA';
		expect(sameServerKey(new Uint8Array([1, 2, 3, 4]).buffer, key)).toBe(true);
		expect(sameServerKey(new Uint8Array([1, 2, 3, 5]).buffer, key)).toBe(false);
		expect(sameServerKey(null, key)).toBe(false);
		expect(sameServerKey(new Uint8Array([1]).buffer, '%%')).toBe(false);
	});

	it('registers a subscription by its endpoint and keys', () => {
		expect(webPushRegistration({ endpoint: 'https://push.example/send/abc', expirationTime: null, keys: { p256dh: 'BPk', auth: 'c2Vj' } }))
			.toEqual({ kind: 'webpush', url: 'https://push.example/send/abc', keys: { p256dh: 'BPk', auth: 'c2Vj' } });
		expect(webPushRegistration({ endpoint: 'https://push.example/send/abc', keys: { p256dh: 'BPk', auth: 'c2Vj' } }, 'a1'))
			.toEqual({ kind: 'webpush', url: 'https://push.example/send/abc', push_id: 'a1', keys: { p256dh: 'BPk', auth: 'c2Vj' } });
		expect(webPushRegistration({ endpoint: 'https://push.example/send/abc', keys: { p256dh: 'BPk', auth: 'c2Vj' } }, 'a1', ['mentions', 'private']))
			.toEqual({ kind: 'webpush', url: 'https://push.example/send/abc', push_id: 'a1', keys: { p256dh: 'BPk', auth: 'c2Vj' }, wake: ['mentions', 'private'] });
		expect(webPushRegistration({ endpoint: 'https://push.example/send/abc', keys: { p256dh: 'BPk' } })).toBeUndefined();
		expect(webPushRegistration({ keys: { p256dh: 'BPk', auth: 'c2Vj' } })).toBeUndefined();
	});

	it('reads the webpush key from the server frame\'s push kinds', () => {
		const server = { apron: 8, auth: ['guest'] };
		expect(webPushKey({ ...server, push: { relay: {}, webpush: { key: 'BNcR' } } })).toBe('BNcR');
		expect(webPushKey({ ...server, push: { relay: {} } })).toBeUndefined();
		expect(webPushKey({ ...server, push: { webpush: { key: '' } } })).toBeUndefined();
		expect(webPushKey(server)).toBeUndefined();
		expect(webPushKey(undefined)).toBeUndefined();
	});

	it('reads the wake scopes the server pushes', () => {
		expect(offeredWake({ webpush: { key: 'BNcR' }, wake: ['mentions', 'replies', 'ext:x', 3] })).toEqual(['mentions', 'replies', 'ext:x']);
		expect(offeredWake({ webpush: { key: 'BNcR' } })).toEqual([]);
		expect(offeredWake(undefined)).toEqual([]);
	});

	it('names an account on a server, and finds its server again', () => {
		const ada = webPushAccount('wss://server.apron.chat/', 'ada');
		expect(ada).toBe('wss://server.apron.chat/\nada');
		expect(accountServer(ada)).toBe('wss://server.apron.chat/');
		expect(accountServer('wss://bare/')).toBe('wss://bare/');
	});
});

describe('installing', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubBrowser(userAgent: string, options: { platform?: string; touch?: number; standalone?: boolean; displayMode?: boolean } = {}): void {
		vi.stubGlobal('navigator', { userAgent, platform: options.platform ?? '', maxTouchPoints: options.touch ?? 0, ...(options.standalone !== undefined ? { standalone: options.standalone } : {}) });
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' && options.displayMode === true }));
	}

	it('asks iPhone and iPad Safari to add Apron to the Home Screen, until it runs from there', () => {
		stubBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
		expect(needsHomeScreen()).toBe(true);
		stubBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { platform: 'MacIntel', touch: 5 });
		expect(needsHomeScreen()).toBe(true);
		stubBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', { standalone: true });
		expect(needsHomeScreen()).toBe(false);
		stubBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', { platform: 'MacIntel' });
		expect(needsHomeScreen()).toBe(false);
	});

	it('offers Install app only when the browser offered it and Apron isn\'t installed', () => {
		stubBrowser('Mozilla/5.0 (X11; Linux x86_64) Chrome/140');
		expect(isStandalone()).toBe(false);
		expect(canOfferInstall(new Event('beforeinstallprompt'))).toBe(true);
		expect(canOfferInstall(undefined)).toBe(false);
		stubBrowser('Mozilla/5.0 (X11; Linux x86_64) Chrome/140', { displayMode: true });
		expect(isStandalone()).toBe(true);
		expect(canOfferInstall(new Event('beforeinstallprompt'))).toBe(false);
	});
});

describe('keeping push off', () => {
	it('keeps it off only for a known account: not while the page loads, before the account signs in', () => {
		// Loading: no account yet, and push isn't on for it either. Nothing to unregister.
		expect(keepsPushOff(undefined, false, undefined)).toBe(false);
		// Signed in, push on here: registered, not kept off.
		expect(keepsPushOff('wss://a/#ada', true, undefined)).toBe(false);
		// Off for this account, or held by another server: kept off.
		expect(keepsPushOff('wss://a/#ada', false, undefined)).toBe(true);
		expect(keepsPushOff('wss://a/#ada', true, 'b.example')).toBe(true);
	});
});

describe('sharing the one subscription', () => {
	const ada = 'wss://a.example/\nada';
	const bob = 'wss://b.example/\nbob';
	it('is held by another server only while its account, with another key, still has push on', () => {
		expect(pushHeldBy({ account: bob, key: 'K2' }, ada, 'K1', [ada, bob])).toBe('wss://b.example/');
		// Free once that account turned push off, or ours, or made with our key.
		expect(pushHeldBy({ account: bob, key: 'K2' }, ada, 'K1', [ada])).toBeUndefined();
		expect(pushHeldBy({ account: ada, key: 'K1' }, ada, 'K1', [ada, bob])).toBeUndefined();
		expect(pushHeldBy({ account: bob, key: 'K1' }, ada, 'K1', [ada, bob])).toBeUndefined();
		expect(pushHeldBy(undefined, ada, 'K1', [ada])).toBeUndefined();
	});
});

describe('keeping the push subscription in step', () => {
	const subscription = (endpoint: string): PushSubscriptionJSON => ({ endpoint, keys: { p256dh: 'BPk', auth: 'c2Vj' } });

	/** A browser whose subscribing waits for the test to finish it, recording what ran and whether any overlapped. */
	function fakeBrowser() {
		const log: string[] = [];
		let running = 0;
		let overlapped = false;
		const pending: Array<() => void> = [];
		let endpoint = 0;
		const step = async <T>(name: string, result: () => T): Promise<T> => {
			if (running++) overlapped = true;
			log.push(`${name} start`);
			await new Promise<void>((resolve) => pending.push(resolve));
			log.push(`${name} end`);
			running -= 1;
			return result();
		};
		const browser: PushBrowser = {
			subscribe: () => step('subscribe', () => subscription(`https://push.example/${++endpoint}`)),
			unsubscribe: () => step('unsubscribe', () => undefined),
			endpoint: async () => undefined
		};
		/** Finishes the step under way, once it has started. */
		const finish = async () => {
			await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
			pending.shift()!();
			await new Promise((resolve) => setTimeout(resolve, 0));
		};
		return { browser, log, finish, overlapped: () => overlapped };
	}

	function fakeClient(url = 'wss://a.example/') {
		const calls: Array<[PushRegistration | undefined, string | undefined]> = [];
		return { url, calls, setPushRegistration: (registration: PushRegistration | undefined, userId?: string) => { calls.push([registration, userId]); } };
	}

	it('registers the subscription with the account\'s push_id and wake scopes', async () => {
		const { browser, finish } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser, (account) => `id:${account}`);
		const enabled = sync.enable(client, 'BNcR', 'ada', undefined, ['mentions', 'replies']);
		await finish();
		expect(await enabled).toBe(true);
		const registered = { kind: 'webpush', url: 'https://push.example/1', push_id: 'id:wss://a.example/\nada', keys: { p256dh: 'BPk', auth: 'c2Vj' } };
		expect(client.calls).toEqual([[{ ...registered, wake: ['mentions', 'replies'] }, 'ada']]);
		// An empty `wake` wakes for nothing, and goes as is.
		const nothing = sync.enable(client, 'BNcR', 'ada', undefined, []);
		await finish();
		expect(await nothing).toBe(true);
		expect(client.calls[1][0]).toHaveProperty('wake', []);
		// Without scopes the server's defaults apply: no `wake`.
		const defaults = sync.enable(client, 'BNcR', 'ada');
		await finish();
		expect(await defaults).toBe(true);
		expect(client.calls[2][0]).not.toHaveProperty('wake');
	});

	it('registers nothing when turned off while subscribing, and unsubscribes after the subscribing ends', async () => {
		const { browser, log, finish, overlapped } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser, (account) => `id:${account}`);
		const enabled = sync.enable(client, 'BNcR', 'ada');
		await vi.waitFor(() => expect(log).toEqual(['subscribe start']));
		const disabled = sync.disable(client, true);
		await finish();
		await finish();
		await disabled;
		expect(await enabled).toBe(false);
		expect(log).toEqual(['subscribe start', 'subscribe end', 'unsubscribe start', 'unsubscribe end']);
		expect(overlapped()).toBe(false);
		expect(client.calls).toEqual([[undefined, undefined]]);
	});

	it('turned off and straight back on, unsubscribes first and then registers a new subscription', async () => {
		const { browser, log, finish, overlapped } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser, (account) => `id:${account}`);
		const disabled = sync.disable(client, true);
		const enabled = sync.enable(client, 'BNcR', 'ada');
		await finish();
		await finish();
		await disabled;
		expect(await enabled).toBe(true);
		expect(log).toEqual(['unsubscribe start', 'unsubscribe end', 'subscribe start', 'subscribe end']);
		expect(overlapped()).toBe(false);
		expect(client.calls.map(([registration]) => registration?.url)).toEqual([undefined, 'https://push.example/1']);
	});

	it('drops the subscription when released, after the subscribing under way', async () => {
		const { browser, log, finish, overlapped } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser, (account) => `id:${account}`);
		const enabled = sync.enable(client, 'BNcR', 'ada');
		await vi.waitFor(() => expect(log).toEqual(['subscribe start']));
		const released = sync.release();
		await finish();
		await finish();
		await released;
		expect(await enabled).toBe(false);
		expect(log).toEqual(['subscribe start', 'subscribe end', 'unsubscribe start', 'unsubscribe end']);
		expect(overlapped()).toBe(false);
	});

	it('registers nothing once the client has moved to another server or account', async () => {
		const { browser, log, finish } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser, (account) => `id:${account}`);
		const moved = sync.enable(client, 'BNcR', 'ada');
		await vi.waitFor(() => expect(log).toEqual(['subscribe start']));
		client.url = 'wss://b.example/';
		await finish();
		expect(await moved).toBe(false);
		client.url = 'wss://a.example/';
		let signedIn = 'ada';
		const switched = sync.enable(client, 'BNcR', 'ada', () => signedIn === 'ada');
		await vi.waitFor(() => expect(log).toHaveLength(3));
		signedIn = 'bob';
		await finish();
		expect(await switched).toBe(false);
		// Moved before subscribing started: it doesn't subscribe at all.
		const early = sync.enable(client, 'BNcR', 'ada', () => false);
		expect(await early).toBe(false);
		expect(log).toHaveLength(4);
		expect(client.calls).toEqual([]);
	});
});
