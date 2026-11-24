import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetPasskeyPage, passkeyPageSince, rememberPasskeyPage } from './passkey-route-memory';

describe('where a passkey sign-in last worked', () => {
	const values = new Map<string, string>();
	const day = 24 * 60 * 60 * 1000;
	beforeEach(() => {
		values.clear();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => { values.set(key, value); },
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('keeps the page for 30 days from the first time it worked, for that server only, until forgotten', () => {
		expect(passkeyPageSince('wss://a.example/', 0)).toBeUndefined();
		rememberPasskeyPage('wss://a.example/', 0, 0);
		expect(passkeyPageSince('wss://a.example/', 29 * day)).toBe(0);
		expect(passkeyPageSince('wss://b.example/', 1)).toBeUndefined();
		// A later page sign-in doesn't renew it: after 30 days from the first, the device is asked again.
		rememberPasskeyPage('wss://a.example/', 20 * day, 20 * day);
		expect(passkeyPageSince('wss://a.example/', 30 * day)).toBeUndefined();
		rememberPasskeyPage('wss://a.example/', day, day);
		forgetPasskeyPage('wss://a.example/', day);
		expect(passkeyPageSince('wss://a.example/', day)).toBeUndefined();
	});

	it('reads nothing from storage it can’t use, and never throws', () => {
		values.set('apron.passkeyOnPage', 'not json');
		expect(passkeyPageSince('wss://a.example/')).toBeUndefined();
		vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
		expect(() => rememberPasskeyPage('wss://a.example/', 0)).not.toThrow();
		expect(() => forgetPasskeyPage('wss://a.example/')).not.toThrow();
		expect(passkeyPageSince('wss://a.example/')).toBeUndefined();
	});
});
