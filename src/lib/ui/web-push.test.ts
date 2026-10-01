import { describe, expect, it } from 'vitest';
import { webPushKey } from '$lib/protocol/client';
import { base64UrlToBytes, bytesToBase64Url, sameServerKey, webPushRegistration } from './web-push';

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
});
