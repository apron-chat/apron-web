import { describe, expect, it, vi } from 'vitest';
import { CustomEmojiCatalog } from './custom-emoji.svelte';

const server = (catalog_url: string) => ({ apron: 10, auth: ['guest'], capabilities: ['ext:emoji'], ext: { emoji: { catalog_url } } });
const ANY = () => true;
const CATALOG = { ':partyparrot:': { url: 'https://chat.example/e/parrot.gif', static_url: 'https://chat.example/e/parrot.png', width: 2, height: 1 } };

describe('the custom emoji catalog (ext:emoji)', () => {
	it('fetches only once a key is looked up, keeps it per catalog_url, and shows keys as without it until then', async () => {
		const load = vi.fn(async (url: string) => (url.endsWith('v1.json') ? CATALOG : {}));
		const emoji = new CustomEmojiCatalog(load);
		emoji.apply(server('https://chat.example/e/v1.json'), 'wss://chat.example/ws', ANY);
		expect(load).not.toHaveBeenCalled();
		expect(emoji.resolve(':partyparrot:')).toBeUndefined();
		expect(emoji.resolve(':other:')).toBeUndefined();
		expect(load).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(emoji.catalog).toBeDefined());
		expect(emoji.resolve(':partyparrot:')).toEqual({ src: 'https://chat.example/e/parrot.gif', alt: ':partyparrot:', width: 2, height: 1 });
		// A new catalog_url is a new catalog; the old one comes back without another fetch.
		emoji.apply(server('https://chat.example/e/v2.json'), 'wss://chat.example/ws', ANY);
		expect(emoji.resolve(':partyparrot:')).toBeUndefined();
		await vi.waitFor(() => expect(emoji.catalog).toBeDefined());
		expect(emoji.resolve(':partyparrot:')).toBeUndefined();
		emoji.apply(server('https://chat.example/e/v1.json'), 'wss://chat.example/ws', ANY);
		expect(emoji.resolve(':partyparrot:')).toBeDefined();
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('shows the still copy to someone who prefers reduced motion, and asks nothing of a server without the extension', () => {
		const load = vi.fn(async () => CATALOG);
		const emoji = new CustomEmojiCatalog(load);
		emoji.reducedMotion = true;
		expect(emoji.image({ key: ':p:', url: 'https://e.example/a.gif', static_url: 'https://e.example/a.png', tags: [], hidden: false }).src).toBe('https://e.example/a.png');
		expect(emoji.image({ key: ':p:', url: 'https://e.example/a.gif', tags: [], hidden: false }).src).toBe('https://e.example/a.gif');
		emoji.apply({ apron: 10, auth: [], capabilities: [], ext: { emoji: { catalog_url: 'https://e.example/c.json' } } }, 'wss://e.example/', ANY);
		expect(emoji.resolve(':p:')).toBeUndefined();
		emoji.need();
		expect(load).not.toHaveBeenCalled();
	});

	it('doesn\'t ask again for a catalog that failed', async () => {
		const load = vi.fn(async () => {
			throw new Error('404');
		});
		const emoji = new CustomEmojiCatalog(load);
		emoji.apply(server('https://chat.example/e/gone.json'), 'wss://chat.example/', ANY);
		emoji.need();
		await Promise.resolve();
		emoji.need();
		expect(emoji.resolve(':a:')).toBeUndefined();
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('fetches a catalog only from where media may load, and once it may', async () => {
		const load = vi.fn(async () => CATALOG);
		const emoji = new CustomEmojiCatalog(load);
		let allowed = false;
		emoji.apply(server('https://tracker.example/c.json'), 'wss://chat.example/', (url) => allowed && url.startsWith('https://tracker.example/'));
		expect(emoji.resolve(':partyparrot:')).toBeUndefined();
		emoji.need();
		expect(load).not.toHaveBeenCalled();
		allowed = true;
		emoji.need();
		expect(load).toHaveBeenCalledTimes(1);
		// Inline, it asks nothing of anyone.
		const inline = new CustomEmojiCatalog(load);
		inline.apply(server(`data:application/json,${encodeURIComponent(JSON.stringify(CATALOG))}`), 'wss://chat.example/', () => false);
		inline.need();
		expect(load).toHaveBeenCalledTimes(2);
	});
});
