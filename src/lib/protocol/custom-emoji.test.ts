import { describe, expect, it } from 'vitest';
import type { JsonValue, ServerParams } from './types';
import { catalogUrlOf, emojiKeySegments, isEmojiSequence, parseCatalog, reactionKey, searchCatalog } from './custom-emoji';

const server = (catalog_url: unknown, capabilities = ['ext:emoji']): ServerParams => ({ apron: 9, auth: ['guest'], capabilities, ext: { emoji: { catalog_url: catalog_url as JsonValue } } });

describe('ext:emoji catalog', () => {
	it('takes catalog_url as https, http on a loopback host, or a JSON data URL, only while the server lists ext:emoji', () => {
		expect(catalogUrlOf(server('https://chat.example/e/catalog-7f3a9c.json'))).toBe('https://chat.example/e/catalog-7f3a9c.json');
		expect(catalogUrlOf(server('http://127.0.0.1:8080/e.json'))).toBe('http://127.0.0.1:8080/e.json');
		expect(catalogUrlOf(server('data:application/json,{}'))).toBe('data:application/json,{}');
		expect(catalogUrlOf(server('data:application/json;base64,e30='))).toBe('data:application/json;base64,e30=');
		for (const odd of ['http://chat.example/e.json', 'javascript:alert(1)', 'data:text/html,<b>', '/e.json', 7, undefined]) expect(catalogUrlOf(server(odd))).toBeUndefined();
		expect(catalogUrlOf(server('https://chat.example/e.json', []))).toBeUndefined();
		expect(catalogUrlOf(undefined)).toBeUndefined();
	});

	it('keeps each entry with a key and a url that loads as an avatar, each other field only of its type', () => {
		const catalog = parseCatalog({
			':partyparrot:': { url: 'https://chat.example/e/Qm7x', static_url: 'https://chat.example/e/Qm7x/still', category: 'Parrots', tags: ['party', 3, 'celebrate'] },
			':shipit:': { url: 'https://chat.example/e/Zr8T', width: 64, height: 32, alt: 'Squirrel in a hat‮' },
			':old:': { url: 'https://chat.example/e/old', hidden: true, width: 64 },
			':local:': { url: '/e/local.png' },
			':own:': { url: 'http://chat.example/e/own.png' },
			':insecure:': { url: 'http://elsewhere.example/e.png' },
			'nocolons': { url: 'https://chat.example/e/x' },
			':bad name:': { url: 'https://chat.example/e/x' },
			':nourl:': { alt: 'x' },
			':odd:': { url: 'https://chat.example/e/odd', width: -1, height: 'tall', hidden: 'yes', static_url: 'javascript:x' }
		}, 'http://chat.example');
		expect([...catalog.keys()]).toEqual([':partyparrot:', ':shipit:', ':old:', ':own:', ':odd:']);
		expect(catalog.get(':partyparrot:')).toEqual({ key: ':partyparrot:', url: 'https://chat.example/e/Qm7x', static_url: 'https://chat.example/e/Qm7x/still', category: 'Parrots', tags: ['party', 'celebrate'], hidden: false });
		// Width and height count only together; bidi overrides are ignored (§3.5.2).
		expect(catalog.get(':shipit:')).toMatchObject({ width: 64, height: 32, alt: 'Squirrel in a hat' });
		expect(catalog.get(':old:')).toEqual({ key: ':old:', url: 'https://chat.example/e/old', tags: [], hidden: true });
		expect(catalog.get(':odd:')).toEqual({ key: ':odd:', url: 'https://chat.example/e/odd', tags: [], hidden: false });
		expect(parseCatalog([], undefined).size).toBe(0);
	});

	it('finds keys left to right, adjacent ones and one after a time, case-sensitively', () => {
		const known = (key: string) => [':a:', ':b:', ':partyparrot:'].includes(key);
		expect(emojiKeySegments(':a::b:', known)).toEqual([{ key: ':a:' }, { key: ':b:' }]);
		expect(emojiKeySegments('12:30:partyparrot:', known)).toEqual(['12:30', { key: ':partyparrot:' }]);
		expect(emojiKeySegments(':A: :x:a:', known)).toEqual([':A: :x', { key: ':a:' }]);
		expect(emojiKeySegments('no keys', known)).toEqual(['no keys']);
	});

	it('searches by key, alt and tags, without regard to case, leaving out hidden emoji', () => {
		const catalog = parseCatalog({
			':partyparrot:': { url: 'https://e.example/1', tags: ['Celebrate'] },
			':shipit:': { url: 'https://e.example/2', alt: 'Squirrel in a hat' },
			':party-old:': { url: 'https://e.example/3', hidden: true },
			':cat_party:': { url: 'https://e.example/4' }
		}, undefined);
		const keys = (query: string) => searchCatalog(catalog, query).map((emoji) => emoji.key);
		expect(keys('party')).toEqual([':partyparrot:', ':cat_party:']);
		expect(keys(':PARTYPARROT:')).toEqual([':partyparrot:']);
		expect(keys('squirrel')).toEqual([':shipit:']);
		expect(keys('celebr')).toEqual([':partyparrot:']);
		expect(keys('')).toEqual([':partyparrot:', ':shipit:', ':cat_party:']);
	});
});

describe('reaction entries (§4.7)', () => {
	it('tells an emoji sequence from a key', () => {
		for (const emoji of ['👍', '👍🏽', '🏳️‍🌈', '👨‍👩‍👧', '❤', '❤️', '🇫🇷', '1️⃣', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) expect(isEmojiSequence(emoji), emoji).toBe(true);
		for (const key of [':partyparrot:', '+1', 'ok', '👍👍', '', 'a👍']) expect(isEmojiSequence(key), key).toBe(false);
	});

	it('compares entries without U+FE0F', () => {
		expect(reactionKey('❤️')).toBe(reactionKey('❤'));
		expect(reactionKey('🏳️‍🌈')).toBe('🏳‍🌈');
		expect(reactionKey(':partyparrot:')).toBe(':partyparrot:');
	});
});
