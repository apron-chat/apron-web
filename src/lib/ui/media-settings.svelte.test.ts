import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANY_ORIGIN } from '$lib/protocol/embeds';
import { memoryStorage } from '$lib/test/storage';
import { MediaSettings, parseMediaOrigins } from './media-settings.svelte';

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

	it('trusts the server’s origins, those and the sites added, or any', () => {
		const settings = new MediaSettings();
		const server = ['https://media.example'];
		expect(settings.trusted(server)).toEqual(server);
		settings.update('custom', ['https://cdn.example', 'https://media.example']);
		expect(settings.trusted(server)).toEqual(['https://media.example', 'https://cdn.example']);
		settings.update('all');
		expect(settings.trusted(server)).toEqual(['https://media.example', ANY_ORIGIN]);
		// The sites added stay for when they're chosen again.
		expect(settings.origins).toEqual(['https://cdn.example', 'https://media.example']);
	});

	it('loads what was saved, and the default for anything else', () => {
		const settings = new MediaSettings();
		settings.update('custom', ['https://cdn.example']);
		const again = new MediaSettings();
		again.load();
		expect(again.policy).toBe('custom');
		expect(again.origins).toEqual(['https://cdn.example']);
		localStorage.setItem('apron.media', JSON.stringify({ policy: 'everything', origins: ['http://x.example', 7] }));
		again.load();
		expect(again.policy).toBe('server');
		expect(again.origins).toEqual([]);
	});
});
