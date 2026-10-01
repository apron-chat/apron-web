import { describe, expect, it, vi } from 'vitest';
import { webPushKey } from '$lib/protocol/client';
import type { PushRegistration } from '$lib/protocol/client';
import { base64UrlToBytes, bytesToBase64Url, pushId, sameServerKey, webPushAccount, webPushRegistration, WebPushSync, type PushBrowser } from './web-push';

describe('web push', () => {
	it('decodes base64url keys, padded or not, and encodes them back unpadded', () => {
		expect([...base64UrlToBytes('-_8')]).toEqual([0xfb, 0xff]);
		expect([...base64UrlToBytes('-_8=')]).toEqual([0xfb, 0xff]);
		expect([...base64UrlToBytes('')]).toEqual([]);
		const key = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
		const bytes = base64UrlToBytes(key);
		expect(bytes.length).toBe(65);
		expect(bytes[0]).toBe(0x04);
		expect(bytesToBase64Url(bytes)).toBe(key);
		expect(bytesToBase64Url(bytes.buffer)).toBe(key);
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
		expect(webPushRegistration({ endpoint: 'https://push.example/send/abc', keys: { p256dh: 'BPk' } })).toBeUndefined();
		expect(webPushRegistration({ keys: { p256dh: 'BPk', auth: 'c2Vj' } })).toBeUndefined();
	});

	it('reads the webpush key from the server frame\'s push kinds', () => {
		const server = { apron: 7, auth: ['guest'] };
		expect(webPushKey({ ...server, push: { relay: {}, webpush: { key: 'BNcR' } } })).toBe('BNcR');
		expect(webPushKey({ ...server, push: { relay: {} } })).toBeUndefined();
		expect(webPushKey({ ...server, push: { webpush: { key: '' } } })).toBeUndefined();
		expect(webPushKey(server)).toBeUndefined();
		expect(webPushKey(undefined)).toBeUndefined();
	});

	it('names an account on a server by a short hash, its push_id', async () => {
		const ada = webPushAccount('wss://server.apron.chat/', 'ada');
		expect(ada).toBe('wss://server.apron.chat/\nada');
		const id = await pushId(ada);
		// SHA-256 of the server URL, a newline and the user_id, in base64url, cut to 16 characters.
		expect(id).toBe('Fd1XwTQeRSM33_hP');
		expect(await pushId(ada)).toBe(id);
		expect(await pushId(webPushAccount('wss://server.apron.chat/', 'bob'))).not.toBe(id);
		expect(await pushId(webPushAccount('wss://chat.example/ws', 'ada'))).not.toBe(id);
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
			unsubscribe: () => step('unsubscribe', () => undefined)
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

	it('registers the subscription with the account\'s push_id', async () => {
		const { browser, finish } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser);
		const enabled = sync.enable(client, 'BNcR', 'ada');
		await finish();
		expect(await enabled).toBe(true);
		expect(client.calls).toEqual([[{ kind: 'webpush', url: 'https://push.example/1', push_id: await pushId('wss://a.example/\nada'), keys: { p256dh: 'BPk', auth: 'c2Vj' } }, 'ada']]);
	});

	it('registers nothing when turned off while subscribing, and unsubscribes after the subscribing ends', async () => {
		const { browser, log, finish, overlapped } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser);
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
		const sync = new WebPushSync(browser);
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

	it('registers nothing once the client has moved to another server or account', async () => {
		const { browser, log, finish } = fakeBrowser();
		const client = fakeClient();
		const sync = new WebPushSync(browser);
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
