import { describe, expect, it } from 'vitest';
import data from '@emoji-mart/data/sets/15/native.json';
import { isAutocompleteDismissed, type DismissedAutocomplete } from './autocomplete-dismiss';
import { insertText } from './draft';
import { parseCatalog } from '$lib/protocol/custom-emoji';
import { emojiQuery, searchEmoji, withCustomEmoji } from './emoji-autocomplete';
import { roomQuery, searchRooms, type RoomSuggestion } from './room-autocomplete';

// The composer's inline autocompletes: `:emoji`, `#room`, and closing one with Escape.

describe('emoji autocomplete', () => {
	it('finds a shortcode at the caret and includes its remaining suffix for replacement', () => {
		expect(emojiQuery(['hello :smile'], 12)).toEqual({ query: 'smile', start: 6, end: 12 });
		expect(emojiQuery(['hello :smile there'], 10)).toEqual({ query: 'smi', start: 6, end: 12 });
		expect(emojiQuery([':'], 1)).toBeUndefined();
	});

	it('does not trigger in the middle of words, in email-like text, across mention chips, or on one-letter emoticons, so Enter still sends them', () => {
		expect(emojiQuery(['lol :D'], 6)).toBeUndefined();
		expect(emojiQuery(['ok :p'], 5)).toBeUndefined();
		expect(emojiQuery(['ok :pa'], 6)).toEqual({ query: 'pa', start: 3, end: 6 });
		expect(emojiQuery(['hello:smile'], 11)).toBeUndefined();
		expect(emojiQuery(['mail@example.com'], 12)).toBeUndefined();
		expect(emojiQuery([{ id: 'ada' }, ':smile'], 10)).toBeUndefined();
	});

	it('opens after a mention chip and a space, keeping replacement offsets correct', () => {
		expect(emojiQuery([{ id: 'ada' }, ' :wav'], 9)).toEqual({ query: 'wav', start: 5, end: 9 });
		const parts = [{ id: 'ada' }, ' text :smile after'];
		const found = emojiQuery(parts, 16);

		expect(found).toEqual({ query: 'smile', start: 10, end: 16 });
		expect(insertText(parts, found!.start, found!.end, '😄')).toEqual({
			parts: [{ id: 'ada' }, ' text 😄 after'],
			caret: 12
		});
	});

	it('finds emoji by shortcode and keyword, with exact matches first', () => {
		expect(searchEmoji(data, 'smile')[0]?.id).toBe('smile');
		expect(searchEmoji(data, 'joy').some((item) => item.id === 'joy')).toBe(true);
		expect(searchEmoji(data, '').length).toBe(0);
	});

	it('offers the server\'s custom emoji first, by key, alt or tag, inserting the key (ext:emoji)', () => {
		const catalog = parseCatalog({ ':smile-cat:': { url: 'https://e.example/1', tags: ['happy'] }, ':hidden_smile:': { url: 'https://e.example/2', hidden: true } }, undefined);
		const found = withCustomEmoji(catalog, 'smile', searchEmoji(data, 'smile'), (emoji) => emoji.url);
		expect(found[0]).toEqual({ id: 'smile-cat', name: ':smile-cat:', native: ':smile-cat:', image: 'https://e.example/1' });
		expect(found[1]?.id).toBe('smile');
		expect(found.length).toBeLessThanOrEqual(8);
		expect(withCustomEmoji(catalog, 'happy', [], (emoji) => emoji.url).map((item) => item.native)).toEqual([':smile-cat:']);
		expect(withCustomEmoji(undefined, 'smile', [], () => '')).toEqual([]);
	});
});

const rooms: RoomSuggestion[] = [
	{ id: 'general', title: 'General' },
	{ id: 'deploys', title: 'Deploys' },
	{ id: 'ops-east', title: 'Operations East' },
	{ id: 'ops-west', title: 'Operations West' }
];

describe('room autocomplete', () => {
	it('finds a #room ID at the caret and includes the rest of the token', () => {
		expect(roomQuery(['hi #dep'], 7)).toEqual({ query: 'dep', start: 3, end: 7 });
		expect(roomQuery(['hi #deploys!'], 7)).toEqual({ query: 'dep', start: 3, end: 11 });
		expect(roomQuery(['hi #'], 4)).toEqual({ query: '', start: 3, end: 4 });
		expect(roomQuery(['a#deploys'], 9)).toBeUndefined();
		expect(roomQuery([{ id: 'bob' }, ' #dep'], 9)).toEqual({ query: 'dep', start: 5, end: 9 });
		expect(roomQuery([{ id: 'bob' }, '#dep'], 8)).toBeUndefined();
	});

	it('searches IDs and titles, prioritizing exact and prefix matches', () => {
		expect(searchRooms(rooms, 'ops')).toEqual([rooms[2], rooms[3]]);
		expect(searchRooms(rooms, 'operations west')).toEqual([rooms[3]]);
		expect(searchRooms(rooms, 'deploys')).toEqual([rooms[1]]);
		expect(searchRooms(rooms, 'missing')).toEqual([]);
	});
});

describe('inline autocomplete dismissal', () => {
	it('keeps Escape dismissed until the token or caret changes', () => {
		const dismissed: DismissedAutocomplete = { text: 'hi :smi', caret: 7 };

		// The keyup that follows Escape sees the same draft and stays closed.
		expect(isAutocompleteDismissed(dismissed, 'hi :smi', 7)).toBe(true);
		// Typing or moving the caret lets refreshQuery open the picker again.
		expect(isAutocompleteDismissed(dismissed, 'hi :smil', 8)).toBe(false);
		expect(isAutocompleteDismissed(dismissed, 'hi :smi', 6)).toBe(false);
	});
});
