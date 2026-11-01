import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_ORIGIN } from '$lib/protocol/embeds';
import { memoryStorage } from '$lib/test/storage';
import { MediaSettings, parseBlockedOrigins, parseMediaOrigins } from './media-settings.svelte';

const values = new Map<string, string>();

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage(values));
});

afterEach(() => {
	values.clear();
	vi.unstubAllGlobals();
});

describe('media settings', () => {
	it('reads sites as https origins, from hosts or URLs, each once', () => {
		expect(parseMediaOrigins('cdn.example\nhttps://img.example/a/b.png, http://plain.example  cdn.example:443 ftp://x.example nonsense:/ \n')).toEqual(['https://cdn.example', 'https://img.example']);
	});

	it('trusts the server’s origins and the trusted ones, or any; Always load adds one', () => {
		const settings = new MediaSettings();
		const server = ['https://media.example'];
		expect(settings.policy).toBe('trusted');
		expect(settings.asks).toBe(true);
		expect(settings.trusted(server)).toEqual(server);
		settings.update('trusted', ['https://cdn.example', 'https://media.example']);
		expect(settings.trusted(server)).toEqual(['https://media.example', 'https://cdn.example']);
		settings.trust('https://img.example');
		settings.trust('img.example');
		settings.trust('http://plain.example');
		expect(settings.origins).toEqual(['https://cdn.example', 'https://media.example', 'https://img.example']);
		settings.update('any');
		expect(settings.asks).toBe(false);
		expect(settings.trusted(server)).toEqual(['https://media.example', ANY_ORIGIN]);
		// The trusted origins stay for when they're chosen again, and Always load still adds to them.
		settings.trust('https://more.example');
		expect(settings.policy).toBe('any');
		expect(settings.origins).toContain('https://more.example');
	});

	it('blocks origins over the trusted ones; Block adds one, and they are saved', () => {
		const settings = new MediaSettings();
		settings.update('trusted', ['https://cdn.example']);
		settings.block('https://cdn.example/a.png');
		settings.block('cdn.example');
		settings.block('ads.example');
		expect(settings.blocked).toEqual(['https://cdn.example', 'https://ads.example']);
		// Trusted still lists it: the gates leave it out.
		expect(settings.origins).toEqual(['https://cdn.example']);
		settings.update('any');
		expect(settings.blocked).toEqual(['https://cdn.example', 'https://ads.example']);
		const again = new MediaSettings();
		again.load();
		expect(again.blocked).toEqual(['https://cdn.example', 'https://ads.example']);
		localStorage.setItem('apron.media', JSON.stringify({ policy: 'trusted', origins: [], blocked: ['https://kept.example', 'ftp://x.example', 7] }));
		again.load();
		expect(again.blocked).toEqual(['https://kept.example']);
	});

	it('reads sites to block by host, whatever the scheme, port or trailing dot; no wildcards', () => {
		expect(parseBlockedOrigins('http://plain.example:8080/a.png TRACKER.example. localhost https://cdn.example:443 *.wild.example ftp://x.example http:/slash.example plain.example')).toEqual([
			'https://plain.example',
			'https://tracker.example',
			'https://localhost',
			'https://cdn.example',
			'https://slash.example'
		]);
	});

	it('keeps a page held to the server’s origins held when blocking, and saves the policy chosen', () => {
		const settings = new MediaSettings();
		settings.update('any', ['https://cdn.example']);
		settings.limit();
		settings.block('https://tracker.example');
		expect(settings.trusted([])).toEqual([]);
		expect(settings.policy).toBe('trusted');
		const saved = new MediaSettings();
		saved.load();
		expect(saved.policy).toBe('any');
		expect(saved.blocked).toEqual(['https://tracker.example']);
		settings.setBlocked([]);
		expect(settings.trusted([])).toEqual([]);
		saved.load();
		expect(saved.policy).toBe('any');
		expect(saved.blocked).toEqual([]);
	});

	it('loads what was saved, what earlier versions saved as its nearest, and the default for anything else', () => {
		const settings = new MediaSettings();
		settings.update('trusted', ['https://cdn.example']);
		const again = new MediaSettings();
		again.load();
		expect(again.policy).toBe('trusted');
		expect(again.origins).toEqual(['https://cdn.example']);
		for (const [saved, policy] of [['default', 'trusted'], ['server', 'trusted'], ['custom', 'trusted'], ['all', 'any'], ['any', 'any'], ['everything', 'trusted']]) {
			localStorage.setItem('apron.media', JSON.stringify({ policy: saved, origins: ['https://kept.example', 'http://x.example', 7] }));
			again.load();
			expect(again.policy).toBe(policy);
			expect(again.origins).toEqual(['https://kept.example']);
		}
	});

	it('holds an export to the server’s origins until something is chosen', () => {
		const settings = new MediaSettings();
		settings.update('any', ['https://cdn.example']);
		settings.limit();
		settings.load();
		expect(settings.policy).toBe('trusted');
		expect(settings.trusted([])).toEqual([]);
		settings.trust('https://img.example');
		expect(settings.trusted([])).toEqual(['https://cdn.example', 'https://img.example']);
	});
});
