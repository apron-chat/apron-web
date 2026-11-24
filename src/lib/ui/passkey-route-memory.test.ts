import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notePasskeyRoute, prefersPasskeyPage } from './passkey-route-memory';

describe('where a passkey sign-in last worked', () => {
	const values = new Map<string, string>();
	beforeEach(() => {
		values.clear();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => { values.set(key, value); },
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('prefers the page for 30 days after it worked there, for that server only, until it works here', () => {
		const day = 24 * 60 * 60 * 1000;
		expect(prefersPasskeyPage('wss://a.example/', 0)).toBe(false);
		notePasskeyRoute('wss://a.example/', true, 0);
		expect(prefersPasskeyPage('wss://a.example/', 29 * day)).toBe(true);
		expect(prefersPasskeyPage('wss://b.example/', 1)).toBe(false);
		expect(prefersPasskeyPage('wss://a.example/', 30 * day)).toBe(false);
		notePasskeyRoute('wss://a.example/', false, day);
		expect(prefersPasskeyPage('wss://a.example/', day)).toBe(false);
	});

	it('reads nothing from storage it can’t use, and never throws', () => {
		values.set('apron.passkeyOnPage', 'not json');
		expect(prefersPasskeyPage('wss://a.example/')).toBe(false);
		vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
		expect(() => notePasskeyRoute('wss://a.example/', true)).not.toThrow();
		expect(prefersPasskeyPage('wss://a.example/')).toBe(false);
	});
});
